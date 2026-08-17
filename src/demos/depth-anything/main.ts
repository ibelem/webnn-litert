/**
 * Depth Anything demo page controller. Chrome only — the canvas it points at
 * is a stage owned by DepthAnythingStage and must never be touched by
 * innerHTML/replaceChildren on an ancestor; see CLAUDE.md, the
 * element-identity rule (transferControlToOffscreen is once-per-canvas,
 * forever).
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {DEFAULT_BACKEND, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {DepthAnythingStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from depth-anything.html`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('stage-canvas');
const receiptEl = el<HTMLDivElement>('receipt');
const metricLoadEl = el<HTMLDivElement>('metric-load');
const metricInferenceEl = el<HTMLDivElement>('metric-inference');
const statusEl = el<HTMLDivElement>('status');
const backendRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

const stage = new DepthAnythingStage(canvas);

// Default radio selection comes from the single shared constant, not a
// hardcoded `checked` attribute per demo page — see runner/types.ts.
const defaultRadio = backendRadios.find((r) => r.value === DEFAULT_BACKEND);
if (defaultRadio) defaultRadio.checked = true;

// URL params match the site-wide convention: ?backend= &litertjs=
const params = new URLSearchParams(location.search);
const urlBackend = params.get('backend');
if (urlBackend) {
  const match = backendRadios.find((r) => r.value === urlBackend);
  if (match) match.checked = true;
}
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

function currentBackend(): Backend {
  const checked = backendRadios.find((r) => r.checked);
  return (checked?.value ?? DEFAULT_BACKEND) as Backend;
}

async function runCurrentBackend(): Promise<void> {
  const backend = currentBackend();
  try {
    const record = await stage.run({
      backend,
      litertVersion,
      iterations: 10,
      warmupRuns: 3,
      onProgress: (message) => {
        statusEl.textContent = message;
      },
    });

    renderReceiptBadge(receiptEl, record.delegation, record.warnings);

    const isFull = record.delegation === 'full';
    renderMetricRow(
        metricLoadEl, 'Load + compile',
        record.metrics ? record.metrics.load_and_compile_ms : null, !isFull);
    renderMetricRow(
        metricInferenceEl, 'Inference',
        record.metrics ? record.metrics.median_ms : null, !isFull);

    statusEl.textContent = record.metrics ?
        `done — ${backend} on @litertjs/core@${litertVersion}` :
        (record.error ?? 'failed');

    // Full record to console — everything the page does not show, per
    // CLAUDE.md's "compute all, display little" rule.
    console.log(backend, record);
  } catch (e) {
    // A superseded run's AbortError is expected noise when the visitor
    // switches backends quickly — not a failure worth showing.
    if (e instanceof DOMException && e.name === 'AbortError') return;
    statusEl.textContent = e instanceof Error ? `error: ${e.message}` : String(e);
  }
}

for (const radio of backendRadios) {
  radio.addEventListener('change', () => void runCurrentBackend());
}

void runCurrentBackend();

window.addEventListener('beforeunload', () => stage.dispose());
