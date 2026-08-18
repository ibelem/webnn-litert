/**
 * Depth Anything compare-view controller. Renders one canvas per selected
 * backend, side by side — "the compare view is the product, not a feature"
 * (design doc). Each canvas is its own DepthAnythingStage instance (its own
 * worker, its own transferControlToOffscreen — never shared or rebuilt; see
 * CLAUDE.md, the element-identity rule).
 *
 * Measurement is serial across backends by construction: a `for...of` loop
 * with `await` inside cannot run two iterations concurrently, which is all
 * "measured one at a time" actually requires here. A dedicated scheduler
 * class was deliberately NOT built for this — see runner/scheduler.ts's own
 * doc comment, which reserves that name for a genuine N-already-live-workers
 * mutex if one ever becomes necessary. Don't add one preemptively.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {BACKENDS, DEFAULT_BACKEND, isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {DepthAnythingStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from depth-anything.html`);
  return node as T;
}

const statusEl = el<HTMLDivElement>('status');
const gridEl = el<HTMLDivElement>('compare-grid');
const backendBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

// URL params match the site-wide convention: ?backend=a,b &litertjs=
const params = new URLSearchParams(location.search);
const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
if (urlBackends?.length) {
  for (const box of backendBoxes) box.checked = urlBackends.includes(box.value as Backend);
} else {
  for (const box of backendBoxes) box.checked = box.value === DEFAULT_BACKEND;
}
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

interface Card {
  stage: DepthAnythingStage;
  receiptEl: HTMLDivElement;
  metricLoadEl: HTMLDivElement;
  metricInferenceEl: HTMLDivElement;
}

const cards = new Map<Backend, Card>();

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

  // transferControlToOffscreen happens inside this constructor, exactly
  // once, for this canvas — see DepthAnythingStage / the element-identity
  // rule. This card's canvas must never be recreated for the same stage.
  return {stage: new DepthAnythingStage(canvas), receiptEl, metricLoadEl, metricInferenceEl};
}

function destroyCard(backend: Backend): void {
  const card = cards.get(backend);
  if (!card) return;
  card.stage.dispose();
  document.querySelector(`.compare-card[data-backend="${backend}"]`)?.remove();
  cards.delete(backend);
}

function selectedBackends(): Backend[] {
  // Fixed BACKENDS order, not checkbox/DOM order, so the grid layout is
  // stable regardless of click order.
  return BACKENDS.filter((b) => backendBoxes.find((box) => box.value === b)?.checked);
}

/** Bumped on every selection change or run request. A stale run (from a
 *  selection the visitor already changed away from) checks this before
 *  touching the DOM instead of racing a fresher one. */
let generation = 0;

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

  // Serial by construction — see file header. Concurrent backends would
  // contend for memory bandwidth and thermal headroom and corrupt each
  // other's timings.
  for (const backend of backends) {
    if (myGeneration !== generation) return; // superseded by a newer selection

    const card = cards.get(backend);
    if (!card) continue; // destroyed mid-run by a selection change

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

      if (myGeneration !== generation || !cards.has(backend)) continue; // stale

      renderReceiptBadge(card.receiptEl, record.delegation, record.warnings);
      const isFull = record.delegation === 'full';
      renderMetricRow(
          card.metricLoadEl, 'Load + compile',
          record.metrics ? record.metrics.load_and_compile_ms : null, !isFull);
      renderMetricRow(
          card.metricInferenceEl, 'Inference',
          record.metrics ? record.metrics.median_ms : null, !isFull);

      // Full record to console — everything the page does not show, per
      // CLAUDE.md's "compute all, display little" rule.
      console.log(backend, record);
    } catch (e) {
      // A superseded run's AbortError is expected noise when the visitor
      // changes selection mid-flight — not a failure worth showing.
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
