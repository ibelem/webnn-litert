/**
 * Selfie-multiclass compare-view controller. Same one-card-per-backend shape
 * as the other demos, but NOT built on runner/compare-controller.ts: this
 * page gates on a webcam-capture button and distributes one captured frame
 * to every card's stage via `stage.setFrame()` before running, which the
 * shared factory has no hook for. See compare-controller.ts's own doc
 * comment for why that hook wasn't added preemptively for one caller.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {BACKENDS, isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {createLogger} from '../../ui/log-status';
import {captureOneFrame, SelfieMulticlassStage} from './stage';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from selfie-multiclass.html`);
  return node as T;
}

const gridEl = el<HTMLDivElement>('compare-grid');
const captureButton = el<HTMLButtonElement>('capture');
const logStatusEl = el<HTMLDivElement>('log-status');
const backendBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

const params = new URLSearchParams(location.search);
const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
if (urlBackends?.length) {
  for (const box of backendBoxes) box.checked = urlBackends.includes(box.value as Backend);
}
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

interface Card {
  stage: SelfieMulticlassStage;
  receiptEl: HTMLDivElement;
  metricLoadEl: HTMLDivElement;
  metricInferenceEl: HTMLDivElement;
}

const cards = new Map<Backend, Card>();
let lastFrame: ImageBitmap | null = null;
let generation = 0;
let currentIterations = getInitialInferenceCount();
let currentLitertVersion = litertVersion;
const logger = createLogger(logStatusEl);

// Listen for inference count changes from the slider
document.addEventListener('inferenceCountChanged', (e: Event) => {
  const customEvent = e as CustomEvent<{count: number}>;
  currentIterations = customEvent.detail.count;
});

// Listen for LiteRT version changes from the dropdown
document.addEventListener('litertVersionChanged', (e: Event) => {
  const customEvent = e as CustomEvent<{version: string}>;
  currentLitertVersion = customEvent.detail.version;
});

function createCard(backend: Backend): Card {
  const wrap = document.createElement('div');
  wrap.className = 'compare-card';
  wrap.dataset.backend = backend;

  const header = document.createElement('div');
  header.className = 'compare-card__header';

  const label = document.createElement('div');
  label.className = 'compare-card__label';
  label.textContent = backend;

  const receiptEl = document.createElement('div');
  receiptEl.className = 'receipt-badge';

  header.append(label, receiptEl);

  const stageWrap = document.createElement('div');
  stageWrap.className = 'compare-card__stage';
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  stageWrap.append(canvas);

  const metrics = document.createElement('div');
  metrics.className = 'compare-card__metrics';
  const metricLoadEl = document.createElement('div');
  const metricInferenceEl = document.createElement('div');
  metrics.append(metricLoadEl, metricInferenceEl);

  wrap.append(header, stageWrap, metrics);
  gridEl.append(wrap);

  return {stage: new SelfieMulticlassStage(canvas), receiptEl, metricLoadEl, metricInferenceEl};
}

function destroyCard(backend: Backend): void {
  const card = cards.get(backend);
  if (!card) return;
  card.stage.dispose();
  document.querySelector(`.compare-card[data-backend="${backend}"]`)?.remove();
  cards.delete(backend);
}

function selectedBackends(): Backend[] {
  return BACKENDS.filter((b) => backendBoxes.find((box) => box.value === b)?.checked);
}

/** e.g. "Inference (Median of 10 Runs)" — falls back to a bare label before
 *  any run has produced a sample count yet. */
function inferenceLabel(runCount: number | undefined): string {
  if (!runCount) return 'Inference';
  return `Inference (Median of ${runCount} Run${runCount === 1 ? '' : 's'})`;
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
  if (!lastFrame) return; // nothing captured yet — checkbox changes just reconcile UI

  const myGeneration = ++generation;
  reconcileCards();
  const backends = selectedBackends();

  if (!backends.length) {
    logger.log('Select at least one backend');
    return;
  }
  for (const backend of backends) {
    if (myGeneration !== generation) return;
    const card = cards.get(backend);
    if (!card || !lastFrame) continue;

    try {
      await card.stage.setFrame(lastFrame);
      const record = await card.stage.run({
        backend,
        litertVersion: currentLitertVersion,
        iterations: currentIterations,
        warmupRuns: 3,
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

captureButton.addEventListener('click', () => {
  void (async () => {
    captureButton.disabled = true;
    logger.log('requesting camera…');
    try {
      lastFrame?.close();
      lastFrame = await captureOneFrame();
      logger.log('snapshot captured');
      await runAll();
    } catch (e) {
      logger.log(e instanceof Error ? `camera error: ${e.message}` : String(e));
    } finally {
      captureButton.disabled = false;
    }
  })();
});

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

for (const box of backendBoxes) {
  box.addEventListener('change', () => {
    updateBackendUrlParameter();
    reconcileCards();
    void runAll(); // no-op if nothing captured yet
  });
}

// Setup LiteRT version dropdown
setupLiteRtVersionDropdown();

// Setup inference count control
setupInferenceCount();

// Reconcile cards on load in case a `?backend=` URL param pre-checked boxes;
// otherwise the grid stays empty and shows its "select a backend" placeholder.
reconcileCards();
logger.log('select a backend, then click "Take Snapshot & Run" — requires camera permission');

window.addEventListener('beforeunload', () => {
  for (const backend of [...cards.keys()]) destroyCard(backend);
  lastFrame?.close();
});
