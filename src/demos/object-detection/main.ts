/**
 * Object-detection page controller. Two independent run modes share this
 * page: the discrete N-backend compare grid for a single image (unchanged
 * from before), and a live single-backend loop for a camera feed or an
 * uploaded video file. The latter reuses one code path — see
 * ObjectDetectionLiveStage's doc comment — because a played-back video's
 * `captureStream()` and a webcam's `getUserMedia()` both hand back a plain
 * MediaStreamTrack.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {createLogger} from '../../ui/log-status';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';
import {getCurrentImageSize, setupImageUpload} from '../../ui/image-upload';
import {Yolo26Stage} from './stage';
import {acquireCameraTrack, acquireVideoFileTrack} from '../../runner/live-stage';
import {ObjectDetectionLiveStage} from './stage-live';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from object-detection.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;
let currentLitertVersion = litertVersion;

/** ONE logger for the whole page. createLogger keeps its own line buffer
 *  and renders by replacing #log-status's entire textContent, so a second
 *  logger on the same element silently wipes the first one's history —
 *  the first live line used to erase the whole image-mode transcript. */
const liveLogger = createLogger(el('log-status'));

// ---- Image mode: unchanged N-backend compare grid ----

const controller = createCompareController({
  gridEl: el('compare-grid'),
  backendBoxes: [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')],
  litertVersion,
  iterations: getInitialInferenceCount(),
  logger: liveLogger,
  createStage: (canvas) => ({
    stage: new Yolo26Stage(canvas),
    container: canvas,
  }),
  getSourceSize: getCurrentImageSize,
  canvasWidth: 640,
  canvasHeight: 640,
  // The compare grid is for Image mode ONLY. Without this gate it auto-ran a
  // full warmup + N-iteration measurement on load whenever `?backend=` was
  // present, even in Video/Camera mode — which is why that mode showed an
  // empty canvas while the shared log filled with "Inferencing 50/50" and
  // "P90" lines from a discrete run nobody asked for.
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
const inputModeRadios = [...document.querySelectorAll<HTMLInputElement>('input[name="input-mode"]')];
const imageControls = el<HTMLDivElement>('image-controls');
const liveControls = el<HTMLDivElement>('live-controls');
const imageModePanel = el<HTMLDivElement>('image-mode-panel');
const liveModePanel = el<HTMLDivElement>('live-mode-panel');
const compareGrid = el<HTMLDivElement>('compare-grid');
const liveGrid = el<HTMLDivElement>('live-grid');

if (urlLiveBackend) {
  for (const radio of liveBackendRadios) radio.checked = radio.value === urlLiveBackend;
}

const liveStage = new ObjectDetectionLiveStage(liveCanvas);
let live = false;
let videoFileUrl: string | null = null;

type InputMode = 'image' | 'video' | 'camera';

function currentInputMode(): InputMode {
  const checked = inputModeRadios.find((r) => r.checked);
  return (checked?.value as InputMode | undefined) ?? 'image';
}

function selectedLiveBackend(): Backend | null {
  const checked = liveBackendRadios.find((r) => r.checked);
  return checked && isBackend(checked.value) ? checked.value : null;
}

function setLiveControlsDisabled(disabled: boolean): void {
  for (const radio of liveBackendRadios) radio.disabled = disabled;
  videoUpload.disabled = disabled;
}

/** Switches the visible panel/grid for the chosen input mode. Stops any
 *  running live session first — a mode switch mid-run has nowhere sensible
 *  to continue, and the site's "measured serially" rule already forbids
 *  two loops at once, so the simplest correct answer is: stop it. */
function applyInputMode(mode: InputMode): void {
  if (live) void stopLive();

  const isImage = mode === 'image';
  imageControls.hidden = !isImage;
  imageModePanel.hidden = !isImage;
  compareGrid.hidden = !isImage;

  liveControls.hidden = isImage;
  liveModePanel.hidden = isImage;
  liveGrid.hidden = isImage;

  videoSourceControls.hidden = mode !== 'video';
  liveToggleButton.textContent = mode === 'camera' ? 'Start Camera' : 'Start Detection';
  liveToggleButton.disabled = mode === 'video' && !videoFileUrl;

  // Switching back into Image mode re-opens the gate above; nothing else
  // would kick the grid, since its own listeners only fire on visitor input.
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
  liveToggleButton.textContent = currentInputMode() === 'camera' ? 'Start Camera' : 'Start Detection';
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
liveLogger.log('select "Video file" or "Camera" above, pick a backend, then start');

window.addEventListener('beforeunload', () => {
  controller.dispose();
  liveStage.dispose();
  if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
});
