import {findDemo} from '../../registry';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {formatProgress, readWithProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage} from '../../runner/worker-protocol';
import SelfieMulticlassWorker from './worker-entry.ts?worker';

const found = findDemo('selfie-multiclass');
if (!found) throw new Error('registry missing selfie-multiclass entry');
const DEMO = found;

/**
 * Grabs exactly one frame from the webcam and releases the camera
 * immediately after — no persistent stream, no <video> element. Requires a
 * user gesture (browser permission prompt); call this from a click handler,
 * not on page load. Shared once by the page controller, then distributed to
 * every live stage via `SelfieMulticlassStage.setFrame`.
 */
export async function captureOneFrame(): Promise<ImageBitmap> {
  const stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
  try {
    const [track] = stream.getVideoTracks();
    if (!track) throw new Error('getUserMedia returned no video track');

    const processor = new MediaStreamTrackProcessor({track});
    const reader = processor.readable.getReader();
    try {
      const {value: frame, done} = await reader.read();
      if (done || !frame) throw new Error('no frame read from webcam track');
      try {
        return await createImageBitmap(frame);
      } finally {
        frame.close();
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    // Release the camera the instant we have one frame — this is a
    // snapshot tool, not a live feed; holding the stream open would light
    // up the camera indicator for no reason.
    for (const track of stream.getTracks()) track.stop();
  }
}

export interface RunParams {
  backend: Backend;
  litertVersion: string;
  iterations: number;
  warmupRuns: number;
  onProgress?: (message: string) => void;
}

/**
 * Same shape as DepthAnythingStage, plus one-shot webcam capture in place of
 * a static sample image. See that file for the canvas/worker/cancellation
 * invariants — they apply identically here.
 *
 * Capture is a SNAPSHOT, not a continuous loop: one frame, grabbed on
 * request, run through the same single-shot compare pipeline as every other
 * demo. CLAUDE.md flags MediaStreamTrackProcessor + continuous capture as a
 * deliberate deferral past the first demo — this is that deferral still in
 * effect for the second one too. A live per-frame loop is a materially
 * different UI (metrics update continuously; "measured sequentially" no
 * longer describes a discrete run) and is future work, not silently
 * expanded into here.
 */
export class SelfieMulticlassStage {
  private readonly worker: Worker;
  private readonly scheduler = new MeasurementScheduler();
  private modelBytesCache: ArrayBuffer | null = null;
  private capturedFrame: ImageBitmap | null = null;
  private nextRequestId = 0;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new SelfieMulticlassWorker();
    const init: MainToWorkerMessage = {type: 'init', canvas: offscreen};
    this.worker.postMessage(init, [offscreen]);
  }

  /**
   * Adopts an already-captured frame (cloned, so this stage owns an
   * independent copy). Capture itself is NOT a per-stage concern — see
   * `captureOneFrame` below — because with N backends selected, N stages
   * each opening their own `getUserMedia` would open the camera N times in a
   * row for one logical "take a photo" action. The page captures once and
   * distributes the same frame to every live stage.
   */
  async setFrame(frame: ImageBitmap): Promise<void> {
    this.capturedFrame?.close();
    this.capturedFrame = await createImageBitmap(frame);
  }

  private async loadModelBytes(onProgress?: (m: string) => void): Promise<ArrayBuffer> {
    if (this.modelBytesCache) return this.modelBytesCache;
    const res = await fetchModelWithMirrorFallback(DEMO.model.url);
    if (!res.ok) throw new Error(`model fetch ${res.status} — ${DEMO.model.url}`);
    const bytes = await readWithProgress(
        res, (p) => onProgress?.(`fetching model… ${formatProgress(p)}`));
    this.modelBytesCache = bytes.buffer as ArrayBuffer;
    return this.modelBytesCache;
  }

  /**
   * Runs one backend against the most recently captured frame. Throws if no
   * frame has been captured yet.
   */
  async run(params: RunParams): Promise<RunRecord> {
    if (!this.capturedFrame) throw new Error('no frame captured — call captureFromWebcam() first');

    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');

    const cached = await this.loadModelBytes(params.onProgress);
    if (signal.aborted) throw abortedError();
    const modelBytes = cached.slice(0);

    // Clone rather than transfer the master frame — createImageBitmap on an
    // existing (not-yet-closed) ImageBitmap yields an independent copy, so
    // the same captured frame can be measured against multiple backends
    // without recapturing from the webcam each time.
    const image = await createImageBitmap(this.capturedFrame);
    if (signal.aborted) {
      image.close();
      throw abortedError();
    }

    params.onProgress?.(`measuring ${params.backend}…`);
    return new Promise<RunRecord>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
        const msg = event.data;
        if (msg.requestId !== requestId) return;
        this.worker.removeEventListener('message', onMessage);
        if (!isCurrent()) {
          reject(abortedError());
          return;
        }
        if (msg.type === 'record') resolve(msg.record);
        else reject(new Error(msg.message));
      };
      this.worker.addEventListener('message', onMessage);

      const runMsg: MainToWorkerMessage = {
        type: 'run',
        requestId,
        backend: params.backend,
        litertVersion: params.litertVersion,
        modelBytes,
        iterations: params.iterations,
        warmupRuns: params.warmupRuns,
        image,
      };
      this.worker.postMessage(runMsg, [modelBytes, image]);
    });
  }

  dispose(): void {
    this.scheduler.cancelCurrent();
    this.capturedFrame?.close();
    this.worker.terminate();
  }
}
