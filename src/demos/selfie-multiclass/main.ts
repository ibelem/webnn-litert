/**
 * Selfie-multiclass compare-view controller. Same one-card-per-backend shape
 * as the other demos, but NOT built on runner/compare-controller.ts: this
 * page gates on a webcam-capture button and distributes one captured frame
 * to every card's stage via `stage.setFrame()` before running, which the
 * shared factory has no hook for. See compare-controller.ts's own doc
 * comment for why that hook wasn't added preemptively for one caller.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {BACKENDS, DEFAULT_BACKEND, isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {captureOneFrame, SelfieMulticlassStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from selfie-multiclass.html`);
  return node as T;
}

const statusEl = el<HTMLDivElement>('status');
const gridEl = el<HTMLDivElement>('compare-grid');
const captureButton = el<HTMLButtonElement>('capture');
const backendBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

const params = new URLSearchParams(location.search);
const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
if (urlBackends?.length) {
  for (const box of backendBoxes) box.checked = urlBackends.includes(box.value as Backend);
} else {
  for (const box of backendBoxes) box.checked = box.value === DEFAULT_BACKEND;
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

function createCard(backend: Backend): Card {
  const wrap = document.createElement('div');
  wrap.className = 'compare-card';
  wrap.dataset.backend = backend;

  const label = document.createElement('div');
  label.className = 'compare-card__label';
  label.textContent = backend;

  const stageWrap = document.createElement('div');
  stageWrap.className = 'compare-card__stage';
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  stageWrap.append(canvas);

  const receiptEl = document.createElement('div');
  receiptEl.className = 'receipt-badge';

  const metrics = document.createElement('div');
  metrics.className = 'compare-card__metrics';
  const metricLoadEl = document.createElement('div');
  const metricInferenceEl = document.createElement('div');
  metrics.append(metricLoadEl, metricInferenceEl);

  wrap.append(label, stageWrap, receiptEl, metrics);
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
    statusEl.textContent = 'select at least one backend';
    return;
  }

  for (const backend of backends) {
    if (myGeneration !== generation) return;
    const card = cards.get(backend);
    if (!card || !lastFrame) continue;

    statusEl.textContent = `measuring ${backend}…`;
    try {
      await card.stage.setFrame(lastFrame);
      const record = await card.stage.run({
        backend,
        litertVersion,
        iterations: 10,
        warmupRuns: 3,
        onProgress: (message) => {
          if (myGeneration === generation) statusEl.textContent = `${backend}: ${message}`;
        },
      });

      if (myGeneration !== generation || !cards.has(backend)) continue;

      renderReceiptBadge(card.receiptEl, record.delegation, record.warnings);
      const isFull = record.delegation === 'full';
      renderMetricRow(
          card.metricLoadEl, 'Load + compile',
          record.metrics ? record.metrics.load_and_compile_ms : null, !isFull);
      renderMetricRow(
          card.metricInferenceEl, 'Inference',
          record.metrics ? record.metrics.median_ms : null, !isFull);

      console.log(backend, record);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') continue;
      if (myGeneration !== generation || !cards.has(backend)) continue;
      renderReceiptBadge(card.receiptEl, 'failed', []);
      statusEl.textContent = e instanceof Error ? `${backend}: ${e.message}` : String(e);
    }
  }

  if (myGeneration === generation) {
    statusEl.textContent = `done — measured sequentially on @litertjs/core@${litertVersion}`;
  }
}

captureButton.addEventListener('click', () => {
  void (async () => {
    captureButton.disabled = true;
    statusEl.textContent = 'requesting camera…';
    try {
      lastFrame?.close();
      lastFrame = await captureOneFrame();
      statusEl.textContent = 'snapshot captured';
      await runAll();
    } catch (e) {
      statusEl.textContent = e instanceof Error ? `camera error: ${e.message}` : String(e);
    } finally {
      captureButton.disabled = false;
    }
  })();
});

for (const box of backendBoxes) {
  box.addEventListener('change', () => {
    reconcileCards();
    void runAll(); // no-op if nothing captured yet
  });
}

// Reconcile cards on load so the grid shows the default selection's empty
// cards immediately, even before the first capture.
reconcileCards();
statusEl.textContent = 'click "Take snapshot & run" to start — requires camera permission';

window.addEventListener('beforeunload', () => {
  for (const backend of [...cards.keys()]) destroyCard(backend);
  lastFrame?.close();
});
