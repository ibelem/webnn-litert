/**
 * Live segmentation page controller — bespoke, like selfie-multiclass, but
 * further from compare-controller.ts's shape than that one: this isn't a
 * discrete run at all, so there's no N-backend compare grid, just one radio
 * picker (only one backend can be live at a time) and a single card.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {createLogger} from '../../ui/log-status';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {EfficientVitLiveStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from efficientvit-live.html`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('live-canvas');
const labelEl = el<HTMLDivElement>('live-label');
const receiptEl = el<HTMLDivElement>('live-receipt');
const metricLoadEl = el<HTMLDivElement>('live-metric-load');
const metricInferenceEl = el<HTMLDivElement>('live-metric-inference');
const toggleButton = el<HTMLButtonElement>('live-toggle');
const logStatusEl = el<HTMLDivElement>('log-status');
const backendRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

const params = new URLSearchParams(location.search);
const urlBackend = params.get('backend');
if (urlBackend && isBackend(urlBackend)) {
  for (const radio of backendRadios) radio.checked = radio.value === urlBackend;
}
let currentLitertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

const logger = createLogger(logStatusEl);
const stage = new EfficientVitLiveStage(canvas);
let live = false;

function selectedBackend(): Backend | null {
  const checked = backendRadios.find((r) => r.checked);
  return checked && isBackend(checked.value) ? checked.value : null;
}

function setControlsDisabled(disabled: boolean): void {
  for (const radio of backendRadios) radio.disabled = disabled;
}

function updateBackendUrlParameter(backend: Backend | null): void {
  const params = new URLSearchParams(location.search);
  if (backend) params.set('backend', backend);
  else params.delete('backend');
  history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
}

async function startLive(): Promise<void> {
  const backend = selectedBackend();
  if (!backend) {
    logger.log('select a backend first');
    return;
  }

  labelEl.textContent = backend;
  toggleButton.disabled = true;
  setControlsDisabled(true);

  try {
    await stage.start(backend, currentLitertVersion, {
      onReady: (receipt) => {
        renderReceiptBadge(receiptEl, receipt.delegation, receipt.warnings);
        const isFull = receipt.delegation === 'full';
        renderMetricRow(metricLoadEl, 'Load + compile', receipt.loadAndCompileMs, !isFull);
        // The live loop starts right after this — the "Inference" row fills
        // in on the first 'stats' message.
        renderMetricRow(metricInferenceEl, 'Inference (live)', null, !isFull);
      },
      onStats: (inferenceMs) => {
        const isFull = receiptEl.classList.contains('receipt-badge--full');
        renderMetricRow(metricInferenceEl, 'Inference (live)', inferenceMs, !isFull);
      },
      onLog: (message) => logger.log(message),
      onError: (message) => {
        renderReceiptBadge(receiptEl, 'failed', [], message);
        logger.log(`${backend}: ${message}`);
        void stopLive();
      },
    }, (message) => logger.log(message));

    live = true;
    toggleButton.textContent = 'Stop';
    toggleButton.disabled = false;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    renderReceiptBadge(receiptEl, 'failed', [], message);
    logger.log(`${backend}: ${message}`);
    setControlsDisabled(false);
    toggleButton.disabled = false;
  }
}

async function stopLive(): Promise<void> {
  toggleButton.disabled = true;
  await stage.stop();
  live = false;
  toggleButton.textContent = 'Start Camera';
  toggleButton.disabled = false;
  setControlsDisabled(false);
}

toggleButton.addEventListener('click', () => {
  void (live ? stopLive() : startLive());
});

// Changing backend while live stops the current session outright — the
// visitor clicks Start again for the new one. No auto-restart: two live
// loops must never overlap (the site's "measured serially" rule, applied
// here as "only one live backend, period").
for (const radio of backendRadios) {
  radio.addEventListener('change', () => {
    updateBackendUrlParameter(selectedBackend());
    if (live) void stopLive();
  });
}

setupLiteRtVersionDropdown();
document.addEventListener('litertVersionChanged', (e: Event) => {
  const customEvent = e as CustomEvent<{version: string}>;
  currentLitertVersion = customEvent.detail.version;
  if (live) void stopLive(); // a version change mid-session needs a fresh compile
});

logger.log('select a backend, then click "Start Camera" — requires camera permission');

window.addEventListener('beforeunload', () => stage.dispose());
