import {renderMetricRow} from '../ui/metric-row';
import {renderReceiptBadge} from '../ui/receipt-badge';
import {createLogger} from '../ui/log-status';
import {BACKENDS, isBackend, type Backend} from './types';
import type {RunRecord} from './types';

/** What every demo's Stage class already implements (DepthAnythingStage,
 *  MobilenetStage, EfficientVitStage, SelfieMulticlassStage). */
export interface StageLike {
  run(params: {
    backend: Backend;
    litertVersion: string;
    iterations: number;
    warmupRuns: number;
    onProgress?: (message: string) => void;
    onLog?: (message: string) => void;
  }): Promise<RunRecord>;
  dispose(): void;
}

export interface CompareControllerOptions {
  gridEl: HTMLElement;
  backendBoxes: HTMLInputElement[];
  litertVersion: string;
  logStatusEl?: HTMLElement;
  /** Creates one demo's Stage bound to a fresh canvas or DOM container.
   *  Called once per backend selected — see element-identity rule in CLAUDE.md:
   *  transferControlToOffscreen happens inside this call, exactly once.
   *  Returns both the stage and the container element to append to the card. */
  createStage: (canvas: HTMLCanvasElement) => {stage: StageLike; container: HTMLElement};
  canvasWidth?: number;
  canvasHeight?: number;
  iterations?: number;
  warmupRuns?: number;
}

/**
 * Factory for the "N backends, same input, side by side" pattern shared by
 * every auto-run demo page (depth-anything, mobilenetv2, efficientvit-seg).
 * Extracted after the third near-identical copy of this controller was
 * about to become a fourth — see the eng review's DRY finding.
 *
 * NOT used by selfie-multiclass: that page gates on a webcam-capture button
 * and distributes one captured frame to every card's stage via
 * `stage.setFrame()` before running, which this generic controller has no
 * hook for. Rather than stretch this factory to cover that with an optional
 * `beforeRun` callback for a single caller, selfie-multiclass keeps its own
 * bespoke copy — see demos/selfie-multiclass/main.ts. Revisit only if a
 * THIRD demo needs a pre-run step; two data points isn't a pattern yet.
 */
export function createCompareController(opts: CompareControllerOptions) {
  const {
    gridEl, backendBoxes, litertVersion, logStatusEl, createStage,
    canvasWidth = 384, canvasHeight = 384,
    // 1 matches the inference-count slider's own HTML default — a caller
    // should really pass ui/inference-count.ts's getInitialInferenceCount()
    // instead of relying on this, so a `?inference=` URL override is honored
    // from the first run rather than only after the visitor touches the
    // slider. This is a fallback for callers that don't.
    iterations = 1, warmupRuns = 3,
  } = opts;

  interface Card {
    stage: StageLike;
    receiptEl: HTMLDivElement;
    metricLoadEl: HTMLDivElement;
    metricInferenceEl: HTMLDivElement;
  }

  const cards = new Map<Backend, Card>();
  let generation = 0;
  let currentIterations = iterations;
  let currentLitertVersion = litertVersion;
  const logger = createLogger(logStatusEl ?? null);

  // Listen for inference count changes from the slider
  document.addEventListener('inferenceCountChanged', (e: Event) => {
    const customEvent = e as CustomEvent<{count: number}>;
    currentIterations = customEvent.detail.count;
    // Re-run with new iteration count
    void runAll();
  });

  // Listen for LiteRT version changes from the dropdown
  document.addEventListener('litertVersionChanged', (e: Event) => {
    const customEvent = e as CustomEvent<{version: string}>;
    currentLitertVersion = customEvent.detail.version;
    // Re-run with new version
    void runAll();
  });

  // Listen for backend checkbox changes and update URL
  backendBoxes.forEach(box => {
    box.addEventListener('change', () => {
      updateBackendUrlParameter();
      void runAll();
    });
  });

  /** e.g. "Inference (Median of 10 Runs)" — falls back to a bare label before
   *  any run has produced a sample count yet. */
  function inferenceLabel(runCount: number | undefined): string {
    if (!runCount) return 'Inference';
    return `Inference (Median of ${runCount} Run${runCount === 1 ? '' : 's'})`;
  }

  function createCard(backend: Backend): Card {
    const wrap = document.createElement('div');
    wrap.className = 'compare-card';
    wrap.dataset.backend = backend;

    const label = document.createElement('div');
    label.className = 'compare-card__label';
    label.textContent = backend;

    const stageWrap = document.createElement('div');
    stageWrap.className = 'compare-card__stage';

    // Create canvas for canvas-based demos, or get container from DOM-based demos
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const {stage, container} = createStage(canvas);
    stageWrap.append(container);

    const receiptEl = document.createElement('div');
    receiptEl.className = 'receipt-badge';

    const metrics = document.createElement('div');
    metrics.className = 'compare-card__metrics';
    const metricLoadEl = document.createElement('div');
    const metricInferenceEl = document.createElement('div');
    metrics.append(metricLoadEl, metricInferenceEl);

    wrap.append(label, stageWrap, receiptEl, metrics);
    gridEl.append(wrap);

    return {stage, receiptEl, metricLoadEl, metricInferenceEl};
  }

  function destroyCard(backend: Backend): void {
    const card = cards.get(backend);
    if (!card) return;
    card.stage.dispose();
    gridEl.querySelector(`.compare-card[data-backend="${backend}"]`)?.remove();
    cards.delete(backend);
  }

  function selectedBackends(): Backend[] {
    return BACKENDS.filter((b) => backendBoxes.find((box) => box.value === b)?.checked);
  }

  function reconcileCards(): void {
    const selected = new Set(selectedBackends());
    for (const backend of [...cards.keys()]) {
      if (!selected.has(backend)) destroyCard(backend);
    }
    for (const backend of selected) {
      if (!cards.has(backend)) cards.set(backend, createCard(backend));
    }
  }

  async function runAll(): Promise<void> {
    const myGeneration = ++generation;
    reconcileCards();
    const backends = selectedBackends();

    if (!backends.length) {
      logger.log('select at least one backend');
      return;
    }

    // Serial by construction: concurrent backends contend for memory
    // bandwidth and thermal headroom and corrupt each other's timings.
    for (const backend of backends) {
      if (myGeneration !== generation) return; // superseded by a newer selection
      const card = cards.get(backend);
      if (!card) continue;

      try {
        const record = await card.stage.run({
          backend,
          litertVersion: currentLitertVersion,
          iterations: currentIterations,
          warmupRuns,
          onLog: (message) => {
            if (myGeneration === generation) logger.log(message);
          },
        });

        if (myGeneration !== generation || !cards.has(backend)) continue;

        renderReceiptBadge(card.receiptEl, record.delegation, record.warnings, record.error);
        const isFull = record.delegation === 'full';
        renderMetricRow(
            card.metricLoadEl, 'Load + compile',
            record.metrics ? record.metrics.load_and_compile_ms : null, !isFull);
        renderMetricRow(
            card.metricInferenceEl, inferenceLabel(record.metrics?.inference_times.length),
            record.metrics ? record.metrics.median_ms : null, !isFull);

        // Full record to console — everything the page does not show, per
        // CLAUDE.md's "compute all, display little" rule.
        console.log(backend, record);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') continue;
        if (myGeneration !== generation || !cards.has(backend)) continue;
        const errorMessage = e instanceof Error ? e.message : String(e);
        renderReceiptBadge(card.receiptEl, 'failed', [], errorMessage);
        logger.log(`${backend}: ${errorMessage}`);
      }
    }
  }

  /** `defaultBackend: null` leaves every box unchecked absent a `?backend=`
   *  param — so the page never auto-runs on load; the visitor's first
   *  checkbox click is what starts anything. */
  function applyUrlBackendSelection(defaultBackend: Backend | null): void {
    const params = new URLSearchParams(location.search);
    const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
    if (urlBackends?.length) {
      for (const box of backendBoxes) box.checked = urlBackends.includes(box.value as Backend);
    } else {
      for (const box of backendBoxes) box.checked = box.value === defaultBackend;
    }
  }

  function updateBackendUrlParameter(): void {
    const selected = selectedBackends();
    const params = new URLSearchParams(location.search);
    
    if (selected.length > 0) {
      params.set('backend', selected.join(','));
    } else {
      params.delete('backend');
    }
    
    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState({}, '', newUrl);
  }

  function dispose(): void {
    for (const backend of [...cards.keys()]) destroyCard(backend);
  }

  return {runAll, reconcileCards, applyUrlBackendSelection, dispose};
}
