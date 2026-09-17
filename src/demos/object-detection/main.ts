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
import {getCurrentImageSize} from '../../ui/image-upload';
import {Yolo26Stage} from './stage';
import {ObjectDetectionLiveStage} from './stage-live';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from object-detection.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;
let currentLitertVersion = litertVersion;

// ---- Image mode: unchanged N-backend compare grid ----

const controller = createCompareController({
  gridEl: el('compare-grid'),
  backendBoxes: [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')],
  litertVersion,
  iterations: getInitialInferenceCount(),
  logStatusEl: el('log-status'),
  createStage: (canvas) => ({
    stage: new Yolo26Stage(canvas),
    container: canvas,
  }),
  getSourceSize: getCurrentImageSize,
  canvasWidth: 640,
  canvasHeight: 640,
});

controller.applyUrlBackendSelection(null);

/** `?backend=` is comma-separated for the compare grid, but live mode runs
 *  exactly one backend — take the first valid entry so arriving at
 *  `?backend=webnn-gpu` and switching to Video/Camera doesn't land on "select
 *  a backend first" with nothing preselected. */
const urlLiveBackend = params.get('backend')?.split(',').map((s) => s.trim()).find(isBackend);

for (const box of document.querySelectorAll<HTMLInputElement>('input[name="backend"]')) {
  box.addEventListener('change', () => void controller.runAll());
}

// ---- Live mode: single backend, continuous — camera or uploaded video ----

const liveCanvas = el<HTMLCanvasElement>('live-canvas');
const liveLabelEl = el<HTMLDivElement>('live-label');
const liveReceiptEl = el<HTMLDivElement>('live-receipt');
const liveMetricLoadEl = el<HTMLDivElement>('live-metric-load');
const liveMetricInferenceEl = el<HTMLDivElement>('live-metric-inference');
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

const liveLogger = createLogger(el('log-status'));
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

/** A camera track from getUserMedia, or one taken from the uploaded video's
 *  own playback via captureStream() — the live stage treats both
 *  identically (see ObjectDetectionLiveStage's doc comment). */
async function acquireTrack(mode: InputMode): Promise<MediaStreamTrack> {
  if (mode === 'camera') {
    const stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
    const [track] = stream.getVideoTracks();
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('getUserMedia returned no video track');
    }
    return track;
  }

  if (!videoFileUrl) throw new Error('choose a video file first');
  await sourceVideo.play();
  const stream = sourceVideo.captureStream();
  const [track] = stream.getVideoTracks();
  if (!track) throw new Error('video file has no video track');
  // Hand over a CLONE, never the element's own track. The stage owns
  // stopping whatever it is given, and a stopped track is dead forever —
  // but captureStream() on a media element may hand back the same cached
  // stream on every call, so stopping the original would make the second
  // Start silently produce no frames (compile succeeds, 'ready' fires,
  // the reader sees done immediately, canvas stays blank). Stopping a
  // clone leaves the element's track live for the next Start.
  return track.clone();
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
    const track = await acquireTrack(mode);
    await liveStage.start(track, backend, currentLitertVersion, {
      onReady: (receipt) => {
        renderReceiptBadge(liveReceiptEl, receipt.delegation, receipt.warnings);
        const isFull = receipt.delegation === 'full';
        renderMetricRow(liveMetricLoadEl, 'Load + compile', receipt.loadAndCompileMs, !isFull);
        renderMetricRow(liveMetricInferenceEl, 'Inference (live)', null, !isFull);
      },
      onStats: (inferenceMs) => {
        const isFull = liveReceiptEl.classList.contains('receipt-badge--full');
        renderMetricRow(liveMetricInferenceEl, 'Inference (live)', inferenceMs, !isFull);
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
