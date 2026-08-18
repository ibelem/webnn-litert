/**
 * MobileNetV2 compare-view controller. Same Map<Backend, Card> pattern as
 * demos/depth-anything/main.ts — see that file for the fuller commentary.
 * Auto-runs on load like depth-anything (static sample image, no user
 * gesture needed, unlike selfie-multiclass's webcam capture).
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {BACKENDS, DEFAULT_BACKEND, isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {MobilenetStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from mobilenetv2.html`);
  return node as T;
}

const statusEl = el<HTMLDivElement>('status');
const gridEl = el<HTMLDivElement>('compare-grid');
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
  stage: MobilenetStage;
  receiptEl: HTMLDivElement;
  metricLoadEl: HTMLDivElement;
  metricInferenceEl: HTMLDivElement;
}

const cards = new Map<Backend, Card>();
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
  // Wider, shorter than the segmentation demos' canvases — this one holds
  // 5 lines of text, not a square image.
  canvas.width = 384;
  canvas.height = 168;
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

  return {stage: new MobilenetStage(canvas), receiptEl, metricLoadEl, metricInferenceEl};
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
    if (!card) continue;

    statusEl.textContent = `measuring ${backend}…`;
    try {
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

for (const box of backendBoxes) {
  box.addEventListener('change', () => void runAll());
}

void runAll();

window.addEventListener('beforeunload', () => {
  for (const backend of [...cards.keys()]) destroyCard(backend);
});
