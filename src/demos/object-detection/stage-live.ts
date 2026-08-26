import {findDemo} from '../../registry';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {loadModelBytesCached} from '../../runner/opfs-cache';
import {formatProgress} from '../../runner/progress-fetch';
import type {Backend, Delegation} from '../../runner/types';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './live-protocol';
import Yolo26LiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('object-detection');
if (!found) throw new Error('registry missing object-detection entry');
const DEMO = found;
if (!DEMO.model.labels) throw new Error('registry object-detection entry has no labels URL');
const LABELS_URL = DEMO.model.labels;

export interface LiveReceipt {
  delegation: Delegation;
  warnings: readonly string[];
  effectiveAccelerator: string;
  loadAndCompileMs: number;
}

export interface StartCallbacks {
  onReady: (receipt: LiveReceipt) => void;
  onStats: (inferenceMs: number) => void;
  onLog?: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Continuous object detection over a live MediaStreamTrack — camera or an
 * uploaded video file's `captureStream()`, the caller picks which and owns
 * requesting it. Mirrors EfficientVitLiveStage: MediaStreamTrack isn't
 * transferable (Chrome throws "does not have a transferable type" on
 * postMessage), so MediaStreamTrackProcessor is constructed here, on the
 * main thread where the track lives, and only its .readable (transferable)
 * goes to the worker — which is why this class, not the worker, stops the
 * track.
 */
export class ObjectDetectionLiveStage {
  private readonly worker: Worker;
  private modelBytesCache: ArrayBuffer | null = null;
  private labelsCache: readonly string[] | null = null;
  private track: MediaStreamTrack | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new Yolo26LiveWorker();
    const init: MainToLiveWorkerMessage = {type: 'init', canvas: offscreen};
    this.worker.postMessage(init, [offscreen]);
  }

  private async loadModelBytes(
      onProgress?: (m: string) => void, onLog?: (m: string) => void): Promise<ArrayBuffer> {
    if (this.modelBytesCache) return this.modelBytesCache;
    const {bytes} = await loadModelBytesCached(
        DEMO.model.url, onLog, (p) => onProgress?.(`fetching model… ${formatProgress(p)}`));
    this.modelBytesCache = bytes;
    return this.modelBytesCache;
  }

  private async loadLabels(): Promise<readonly string[]> {
    if (this.labelsCache) return this.labelsCache;
    const res = await fetchModelWithMirrorFallback(LABELS_URL);
    if (!res.ok) throw new Error(`labels fetch ${res.status} — ${LABELS_URL}`);
    this.labelsCache = (await res.text()).split('\n').map((s) => s.trim()).filter(Boolean);
    return this.labelsCache;
  }

  /**
   * Starts continuous detection against the given track. Caller owns
   * requesting the track (getUserMedia, or an uploaded <video>'s
   * captureStream()) and its lifecycle up to this call — this class takes
   * over stopping it, in stop()/dispose(), same as EfficientVitLiveStage.
   */
  async start(
      track: MediaStreamTrack, backend: Backend, litertVersion: string, callbacks: StartCallbacks,
      onProgress?: (message: string) => void): Promise<void> {
    this.track = track;

    let modelBytes: ArrayBuffer;
    let labels: readonly string[];
    try {
      [modelBytes, labels] = await Promise.all([
        this.loadModelBytes(onProgress, callbacks.onLog),
        this.loadLabels(),
      ]);
    } catch (e) {
      track.stop();
      this.track = null;
      throw e;
    }

    // Constructed here (not in the worker) because MediaStreamTrackProcessor
    // needs the actual track, which never leaves this thread — only its
    // .readable stream (transferable) is handed over below.
    const processor = new MediaStreamTrackProcessor({track});

    return new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<LiveWorkerToMainMessage>): void => {
        const msg = event.data;
        if (msg.type === 'log') {
          callbacks.onLog?.(msg.message);
        } else if (msg.type === 'ready') {
          callbacks.onReady({
            delegation: msg.delegation,
            warnings: msg.warnings,
            effectiveAccelerator: msg.effectiveAccelerator,
            loadAndCompileMs: msg.loadAndCompileMs,
          });
          resolve();
        } else if (msg.type === 'stats') {
          callbacks.onStats(msg.inferenceMs);
        } else if (msg.type === 'error') {
          callbacks.onError(msg.message);
          reject(new Error(msg.message));
        }
        // 'stopped' is handled by stop()'s own listener, not here — this
        // listener stays registered for the whole live session.
      };
      this.worker.addEventListener('message', onMessage);

      const startMsg: MainToLiveWorkerMessage = {
        type: 'start', backend, litertVersion, modelBytes: modelBytes.slice(0), labels,
        readable: processor.readable,
      };
      this.worker.postMessage(startMsg, [startMsg.modelBytes, startMsg.readable]);
    });
  }

  /** Stops the live loop and releases the track. The track is stopped
   *  right here on the main thread (see class doc comment) — resolving
   *  waits only on the worker's 'stopped' to confirm its own resources
   *  (reader, compiled model) are released, so the caller can safely start
   *  a different backend or source once this resolves. */
  stop(): Promise<void> {
    this.track?.stop();
    this.track = null;
    return new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent<LiveWorkerToMainMessage>): void => {
        if (event.data.type === 'stopped') {
          this.worker.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMessage);
      const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
      this.worker.postMessage(stopMsg);
    });
  }

  dispose(): void {
    this.track?.stop();
    this.track = null;
    // Best effort — a page unload doesn't get to wait for 'stopped'.
    const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
    this.worker.postMessage(stopMsg);
    this.worker.terminate();
  }
}
