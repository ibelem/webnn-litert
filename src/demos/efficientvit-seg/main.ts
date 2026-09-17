/**
 * EfficientViT segmentation page controller. Two independent run modes share
 * this page, same as object-detection and depth-anything: the discrete
 * N-backend compare grid for a single image, and a live single-backend loop
 * over a camera feed or an uploaded video file.
 *
 * The live half used to be its own page at /efficientvit-live. It was folded
 * in here once every other demo hosted both modes on one URL — two pages for
 * one model was the odd one out. /efficientvit-live now 301s here (see
 * vercel.json), so old links still land somewhere correct.
 *
 * Note the two modes render DIFFERENTLY on purpose: the still-image path
 * replaces the frame with an opaque mask, while live blends the mask over the
 * sharp source frame. See render-live.ts.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {acquireCameraTrack, acquireVideoFileTrack} from '../../runner/live-stage';
import {isBackend, type Backend} from '../../runner/types';
import {carryOverBackend} from '../../ui/backend-carryover';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {createLogger} from '../../ui/log-status';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';
import {getCurrentImageSize, setupImageUpload} from '../../ui/image-upload';
import {EfficientVitStage} from './stage';
import {EfficientVitLiveStage} from './stage-live';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from efficientvit-seg.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;
let currentLitertVersion = litertVersion;

type InputMode = 'image' | 'video' | 'camera';

const inputModeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="input-mode"]')];

function currentInputMode(): InputMode {
  const checked = inputModeRadios.find((r) => r.checked);
  return (checked?.value as InputMode | undefined) ?? 'image';
}

/** ONE logger for the whole page. createLogger keeps its own line buffer
 *  and renders by replacing #log-status's entire textContent, so a second
 *  logger on the same element silently wipes the first one's history —
 *  the first live line used to erase the whole image-mode transcript. */
const liveLogger = createLogger(el('log-status'));

const compareBackendBoxes =
    [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

// ---- Image mode: N-backend compare grid ----

const controller = createCompareController({
  gridEl: el('compare-grid'),
  backendBoxes: compareBackendBoxes,
  litertVersion,
  iterations: getInitialInferenceCount(),
  logger: liveLogger,
  createStage: (canvas) => ({
    stage: new EfficientVitStage(canvas),
    container: canvas,
  }),
  getSourceSize: getCurrentImageSize,
  // The compare grid is for Image mode ONLY. Without this gate it auto-runs a
  // full warmup + N-iteration measurement on load whenever `?backend=` is
  // present, even in Video/Camera mode — which left that mode showing an empty
  // canvas while the shared log filled with "Inferencing 50/50" and "P90"
  // lines from a discrete run nobody asked for.
  enabled: () => currentInputMode() === 'image',
});

controller.applyUrlBackendSelection(null);

/** `?backend=` is comma-separated for the compare grid, but live mode runs
 *  exactly one backend — take the first valid entry so arriving at
 *  `?backend=webnn-gpu` and switching to Video/Camera doesn't land on "select
 *  a backend first" with nothing preselected. */
const urlLiveBackend = params.get('backend')?.split(',').map((s) => s.trim()).find(isBackend);

// NOTE: no backend `change` listener here on purpose. createCompareController
// already registers one (see its own comment); adding a second made one tick
// fire two passes and measure every backend twice.

// ---- Live mode: single backend, continuous — camera or uploaded video ----

const liveCanvas = el<HTMLCanvasElement>('live-canvas');
const liveLabelEl = el<HTMLDivElement>('live-label');
const liveReceiptEl = el<HTMLDivElement>('live-receipt');
const liveMetricLoadEl = el<HTMLDivElement>('live-metric-load');
const liveMetricInferenceEl = el<HTMLDivElement>('live-metric-inference');
const liveMetricFpsEl = el<HTMLDivElement>('live-metric-fps');
const liveToggleButton = el<HTMLButtonElement>('live-toggle');
const sourceVideo = el<HTMLVideoElement>('source-video');
const videoUpload = el<HTMLInputElement>('video-upload');
const videoSourceControls = el<HTMLDivElement>('video-source-controls');
const liveBackendRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="live-backend"]')];
const imageControls = el<HTMLDivElement>('image-controls');
const liveControls = el<HTMLDivElement>('live-controls');
const imageModePanel = el<HTMLDivElement>('image-mode-panel');
const liveModePanel = el<HTMLDivElement>('live-mode-panel');
const compareGrid = el<HTMLDivElement>('compare-grid');
const liveGrid = el<HTMLDivElement>('live-grid');
/** Layout wrapper, not a control — queried by class because it carries no
 *  id on any page. Null-guarded so a page that ever drops it degrades to
 *  the stacked layout rather than throwing on load. */
const demoContent = document.querySelector<HTMLElement>('.demo-content');

if (urlLiveBackend) {
  for (const radio of liveBackendRadios) radio.checked = radio.value === urlLiveBackend;
}

const liveStage = new EfficientVitLiveStage(liveCanvas);
let live = false;
let videoFileUrl: string | null = null;

function selectedLiveBackend(): Backend | null {
  const checked = liveBackendRadios.find((r) => r.checked);
  return checked && isBackend(checked.value) ? checked.value : null;
}

function setLiveControlsDisabled(disabled: boolean): void {
  for (const radio of liveBackendRadios) radio.disabled = disabled;
  videoUpload.disabled = disabled;
}

/** Switches the visible panel/grid for the chosen input mode. Stops any
 *  running live session first — a mode switch mid-run has nowhere sensible to
 *  continue, and the site's "measured serially" rule already forbids two
 *  loops at once, so the simplest correct answer is: stop it. */
function applyInputMode(mode: InputMode): void {
  if (live) void stopLive();

  const isImage = mode === 'image';
  // Live mode's radio group is a different control from the compare grid's
  // checkboxes, and only one is visible at a time — without this, a backend
  // ticked for compare looked like it had been silently cleared on the way
  // into Video/Camera. See ui/backend-carryover.ts.
  if (!isImage) carryOverBackend(compareBackendBoxes, liveBackendRadios);
  imageControls.hidden = !isImage;
  imageModePanel.hidden = !isImage;
  compareGrid.hidden = !isImage;

  liveControls.hidden = isImage;
  liveModePanel.hidden = isImage;
  liveGrid.hidden = isImage;
  // Moves the run transcript into the empty gutter beside the single live
  // card — see .demo-content--live in components.css.
  demoContent?.classList.toggle('demo-content--live', !isImage);

  videoSourceControls.hidden = mode !== 'video';
  liveToggleButton.textContent = mode === 'camera' ? 'Start Camera' : 'Start Segmentation';
  liveToggleButton.disabled = mode === 'video' && !videoFileUrl;

  // Switching back into Image mode re-opens the compare grid's gate; nothing
  // else would kick it, since its own listeners only fire on visitor input.
  // Already-measured backends are skipped by runKey(), so this is free.
  if (isImage) void controller.runAll();
}

for (const radio of inputModeRadios) {
  radio.addEventListener('change', () => applyInputMode(currentInputMode()));
}

videoUpload.addEventListener('change', () => {
  const file = videoUpload.files?.[0];
  if (!file) return;
  if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
  videoFileUrl = URL.createObjectURL(file);
  sourceVideo.src = videoFileUrl;
  liveToggleButton.disabled = false;
});

/** Camera, or the uploaded video's own playback — LiveStage treats both
 *  identically. Passed as a CALLBACK, not called here: the stage defers it
 *  until the model is compiled, so the source does not run through the ~2s
 *  WebNN build. See runner/live-stage.ts. */
function acquireTrack(mode: InputMode): Promise<MediaStreamTrack> {
  if (mode === 'camera') return acquireCameraTrack();
  if (!videoFileUrl) return Promise.reject(new Error('choose a video file first'));
  return acquireVideoFileTrack(sourceVideo);
}

async function startLive(): Promise<void> {
  const mode = currentInputMode();
  if (mode === 'image') return;

  const backend = selectedLiveBackend();
  if (!backend) {
    liveLogger.log('select a backend first');
    return;
  }

  liveLabelEl.textContent = backend;
  liveToggleButton.disabled = true;
  setLiveControlsDisabled(true);

  try {
    await liveStage.start(() => acquireTrack(mode), backend, currentLitertVersion, {
      onReady: (receipt) => {
        renderReceiptBadge(liveReceiptEl, receipt.delegation, receipt.warnings);
        const isFull = receipt.delegation === 'full';
        renderMetricRow(liveMetricLoadEl, 'Load + compile', receipt.loadAndCompileMs, !isFull);
        renderMetricRow(liveMetricInferenceEl, 'Inference (live)', null, !isFull);
        renderMetricRow(liveMetricFpsEl, 'Frame rate', null, !isFull, 'fps');
      },
      onStats: (inferenceMs, fps) => {
        const isFull = liveReceiptEl.classList.contains('receipt-badge--full');
        renderMetricRow(liveMetricInferenceEl, 'Inference (live)', inferenceMs, !isFull);
        renderMetricRow(liveMetricFpsEl, 'Frame rate', fps, !isFull, 'fps');
      },
      onLog: (message) => liveLogger.log(message),
      onError: (message) => {
        renderReceiptBadge(liveReceiptEl, 'failed', [], message);
        liveLogger.log(`${backend}: ${message}`);
        void stopLive();
      },
    }, (message) => liveLogger.log(message));

    live = true;
    liveToggleButton.textContent = 'Stop';
    liveToggleButton.disabled = false;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    renderReceiptBadge(liveReceiptEl, 'failed', [], message);
    liveLogger.log(`${backend}: ${message}`);
    setLiveControlsDisabled(false);
    liveToggleButton.disabled = false;
  }
}

async function stopLive(): Promise<void> {
  liveToggleButton.disabled = true;
  await liveStage.stop();
  sourceVideo.pause();
  live = false;
  liveToggleButton.textContent =
      currentInputMode() === 'camera' ? 'Start Camera' : 'Start Segmentation';
  liveToggleButton.disabled = currentInputMode() === 'video' && !videoFileUrl;
  setLiveControlsDisabled(false);
}

liveToggleButton.addEventListener('click', () => {
  void (live ? stopLive() : startLive());
});

for (const radio of liveBackendRadios) {
  radio.addEventListener('change', () => {
    if (live) void stopLive();
  });
}

// Called here, not from an inline <script> in the page. Each page used to
// run setupInferenceCount() twice — once inline, once here — which
// registered the slider listener twice and fired every re-measure twice.
setupImageUpload();
setupLiteRtVersionDropdown();
setupInferenceCount();

document.addEventListener('litertVersionChanged', (e: Event) => {
  const customEvent = e as CustomEvent<{version: string}>;
  currentLitertVersion = customEvent.detail.version;
  if (live) void stopLive(); // a version change mid-session needs a fresh compile
});

applyInputMode(currentInputMode());

window.addEventListener('beforeunload', () => {
  controller.dispose();
  liveStage.dispose();
  if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
});
