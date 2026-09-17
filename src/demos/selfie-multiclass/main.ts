/**
 * Selfie-multiclass compare-view controller. Same one-card-per-backend shape
 * as the other demos, but NOT built on runner/compare-controller.ts: this
 * page gates on a webcam-capture button and distributes one captured frame
 * to every card's stage via `stage.setFrame()` before running, which the
 * shared factory has no hook for. See compare-controller.ts's own doc
 * comment for why that hook wasn't added preemptively for one caller.
 *
 * Also hosts a LIVE mode (video file / continuous camera) alongside that
 * snapshot grid, same as object-detection and depth-anything. The two modes
 * must never run at once — they share one log panel, and the site's
 * "measure serially" rule forbids two loops regardless. runAll() is gated
 * on the mode below; switching mode stops whatever is running.
 */
import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {BACKENDS, isBackend, type Backend} from '../../runner/types';
import {renderMetricRow} from '../../ui/metric-row';
import {renderReceiptBadge} from '../../ui/receipt-badge';
import {createLogger} from '../../ui/log-status';
import {acquireCameraTrack, acquireVideoFileTrack} from '../../runner/live-stage';
import {captureOneFrame, SelfieMulticlassStage} from './stage';
import {SelfieMulticlassLiveStage} from './stage-live';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';
import {fitCanvasSize} from '../../ui/canvas-size';

const CANVAS_MAX_DIMENSION = 384;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from selfie-multiclass.html`);
  return node as T;
}

type InputMode = 'image' | 'video' | 'camera';

const inputModeRadios =
    [...document.querySelectorAll<HTMLInputElement>('input[name="input-mode"]')];

/** 'image' is the SNAPSHOT compare grid — the page's original mode. */
function currentInputMode(): InputMode {
  const checked = inputModeRadios.find((r) => r.checked);
  return (checked?.value as InputMode | undefined) ?? 'image';
}

const gridEl = el<HTMLDivElement>('compare-grid');
const captureButton = el<HTMLButtonElement>('capture');
const snapshotPreview = el<HTMLImageElement>('snapshot-preview');
const logStatusEl = el<HTMLDivElement>('log-status');
const backendBoxes = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')];

const params = new URLSearchParams(location.search);
const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
if (urlBackends?.length) {
  for (const box of backendBoxes) box.checked = urlBackends.includes(box.value as Backend);
}
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

interface Card {
  /** The runKey() this card's displayed result was measured with, or null if
   *  it has never produced one. Ticking a SECOND backend must not re-measure
   *  an already-current first one — see runKey(). */
  measuredWith: string | null;
  stage: SelfieMulticlassStage;
  receiptEl: HTMLDivElement;
  metricLoadEl: HTMLDivElement;
  metricInferenceEl: HTMLDivElement;
}

const cards = new Map<Backend, Card>();
let lastFrame: ImageBitmap | null = null;
let previewUrl: string | null = null;
let generation = 0;
/** Bumped on every webcam capture: a new snapshot invalidates every card's
 *  result, a new backend tick does not. */
let captureGeneration = 0;

/**
 * ImageBitmap has no displayable URL of its own — draw it to a scratch
 * canvas and export a blob URL so the sidebar preview (sized like
 * mobilenetv2's `#demo-image` via the shared `.sample-image img` rule) can
 * show exactly what was captured, above the button that captured it.
 */
async function showSnapshotPreview(bitmap: ImageBitmap): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable for snapshot preview');
  ctx.drawImage(bitmap, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (!blob) throw new Error('canvas.toBlob failed for snapshot preview');

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  snapshotPreview.src = previewUrl;
  snapshotPreview.hidden = false;
}
let currentIterations = getInitialInferenceCount();
let currentLitertVersion = litertVersion;
const logger = createLogger(logStatusEl);

/** Sizes a FRESH card's canvas to match the captured frame's aspect ratio
 *  (falls back to a square before anything's been captured). Must run
 *  before `new SelfieMulticlassStage(canvas)` transfers it — Chrome throws
 *  ("Cannot resize canvas after call to transferControlToOffscreen()") on
 *  setting .width/.height afterward. So this only ever runs once per
 *  canvas, at creation — an existing card's canvas keeps whatever ratio it
 *  was created with until that backend is unchecked and rechecked, even if
 *  a later capture has a different shape (unlikely here in practice:
 *  captureOneFrame always requests the same 640x480). */
function resizeCanvasToFrame(canvas: HTMLCanvasElement): void {
  const {width, height} = lastFrame
      ? fitCanvasSize(lastFrame.width, lastFrame.height, CANVAS_MAX_DIMENSION)
      : {width: CANVAS_MAX_DIMENSION, height: CANVAS_MAX_DIMENSION};
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

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

  header.append(label);

  const stageWrap = document.createElement('div');
  stageWrap.className = 'compare-card__stage';
  const canvas = document.createElement('canvas');
  resizeCanvasToFrame(canvas);
  stageWrap.append(canvas);

  const metrics = document.createElement('div');
  metrics.className = 'compare-card__metrics';
  const metricLoadEl = document.createElement('div');
  const metricInferenceEl = document.createElement('div');
  metrics.append(metricLoadEl, metricInferenceEl);

  wrap.append(header, stageWrap, receiptEl, metrics);
  gridEl.append(wrap);

  // Pending rows up front: cards are created for every selected backend but
  // measured serially, so the last one can sit for tens of seconds before its
  // turn — with empty metric divs it read as broken rather than queued.
  renderMetricRow(metricLoadEl, 'Load + compile', null, false);
  renderMetricRow(metricInferenceEl, inferenceLabel(undefined), null, false);

  return {
    stage: new SelfieMulticlassStage(canvas),
    receiptEl, metricLoadEl, metricInferenceEl, measuredWith: null,
  };
}

function destroyCard(backend: Backend): void {
  const card = cards.get(backend);
  if (!card) return;
  card.stage.dispose();
  document.querySelector(`.compare-card[data-backend="${backend}"]`)?.remove();
  cards.delete(backend);
}

/** Everything that invalidates an existing measurement, as one string. A
 *  card whose `measuredWith` equals this is already showing a current result
 *  and MUST NOT be re-measured — re-running it would re-pay the full compile
 *  (~2s on WebNN) for an unchanged answer. Un-tick and re-tick to force one,
 *  which recreates the card and clears `measuredWith`. */
function runKey(): string {
  return `${currentLitertVersion}|${currentIterations}|${captureGeneration}`;
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
  if (currentInputMode() !== 'image') return; // live mode owns the page right now
  if (!lastFrame) return; // nothing captured yet — checkbox changes just reconcile UI

  const myGeneration = ++generation;
  reconcileCards();
  const backends = selectedBackends();

  if (!backends.length) {
    logger.log('Select at least one backend');
    return;
  }

  const key = runKey();

  for (const backend of backends) {
    if (myGeneration !== generation) return;
    const card = cards.get(backend);
    if (!card || !lastFrame) continue;
    // Already showing a current result — see runKey().
    if (card.measuredWith === key) continue;

    try {
      await card.stage.setFrame(lastFrame);
      const record = await card.stage.run({
        backend,
        litertVersion: currentLitertVersion,
        iterations: currentIterations,
        warmupRuns: 3,
        // Wired through so the visitor sees "fetching model... 43%" during a
        // multi-megabyte download, instead of a silent page.
        onProgress: (message) => {
          if (myGeneration === generation) logger.log(`${backend}: ${message}`);
        },
        onLog: (message) => {
          if (myGeneration === generation) logger.log(message);
        },
      });

      if (myGeneration !== generation || !cards.has(backend)) continue;

      card.measuredWith = key;
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
      // Marked measured so ticking a DIFFERENT backend doesn't silently
      // retry this one on every click; un-tick and re-tick to retry.
      card.measuredWith = key;
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
      captureGeneration++; // new snapshot — every card's result is now stale
      await showSnapshotPreview(lastFrame);
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
const liveBackendRadios =
    [...document.querySelectorAll<HTMLInputElement>('input[name="live-backend"]')];
const imageControls = el<HTMLDivElement>('image-controls');
const liveControls = el<HTMLDivElement>('live-controls');
const imageModePanel = el<HTMLDivElement>('image-mode-panel');
const liveModePanel = el<HTMLDivElement>('live-mode-panel');
const liveGrid = el<HTMLDivElement>('live-grid');

// `?backend=` is comma-separated for the snapshot grid, but live mode runs
// exactly one backend — take the first valid entry so arriving with a backend
// in the URL and switching to Video/Camera doesn't land on "select a backend
// first" with nothing preselected.
const urlLiveBackend = urlBackends?.[0];
if (urlLiveBackend) {
  for (const radio of liveBackendRadios) radio.checked = radio.value === urlLiveBackend;
}

const liveStage = new SelfieMulticlassLiveStage(liveCanvas);
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
  imageControls.hidden = !isImage;
  imageModePanel.hidden = !isImage;
  gridEl.hidden = !isImage;

  liveControls.hidden = isImage;
  liveModePanel.hidden = isImage;
  liveGrid.hidden = isImage;

  videoSourceControls.hidden = mode !== 'video';
  liveToggleButton.textContent = mode === 'camera' ? 'Start Camera' : 'Start Segmentation';
  liveToggleButton.disabled = mode === 'video' && !videoFileUrl;

  logger.log(isImage ?
      'select a backend, then click "Take Snapshot & Run" — requires camera permission' :
      'pick a backend, then start — the model downloads and compiles before the camera opens');
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
    logger.log('select a backend first');
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
      onLog: (message) => logger.log(message),
      onError: (message) => {
        renderReceiptBadge(liveReceiptEl, 'failed', [], message);
        logger.log(`${backend}: ${message}`);
        void stopLive();
      },
    }, (message) => logger.log(message));

    live = true;
    liveToggleButton.textContent = 'Stop';
    liveToggleButton.disabled = false;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    renderReceiptBadge(liveReceiptEl, 'failed', [], message);
    logger.log(`${backend}: ${message}`);
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

// A version change mid-session needs a fresh compile. The snapshot grid's own
// listener only updates its variable (it waits for the next Capture), so this
// one only has to handle the live side.
document.addEventListener('litertVersionChanged', () => {
  if (live) void stopLive();
});

applyInputMode(currentInputMode());

window.addEventListener('beforeunload', () => {
  for (const backend of [...cards.keys()]) destroyCard(backend);
  lastFrame?.close();
  liveStage.dispose();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (videoFileUrl) URL.revokeObjectURL(videoFileUrl);
});
