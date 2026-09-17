import {findDemo} from '../../registry';
import {loadModelBytesCached} from '../../runner/opfs-cache';
import {formatProgress} from '../../runner/progress-fetch';
import type {Backend, Delegation} from '../../runner/types';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './live-protocol';
import Yolo26LiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('object-detection');
if (!found) throw new Error('registry missing object-detection entry');
const DEMO = found;

export interface LiveReceipt {
  delegation: Delegation;
  warnings: readonly string[];
  effectiveAccelerator: string;
  loadAndCompileMs: number;
}

export interface StartCallbacks {
  onReady: (receipt: LiveReceipt) => void;
  onStats: (inferenceMs: number, fps: number) => void;
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
  private track: MediaStreamTrack | null = null;
  private sessionListener: ((event: MessageEvent<LiveWorkerToMainMessage>) => void) | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;

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

  /**
   * Downloads and compiles the model, and ONLY THEN calls `acquireTrack` to
   * open the camera / start the uploaded video. That order is deliberate:
   * compiling takes ~2s on WebNN, and doing it with the source already
   * running lit the camera indicator (or played the video unwatched) for
   * seconds before a single frame was used.
   *
   * `acquireTrack` is a callback rather than a plain track parameter for
   * exactly that reason — the caller still owns HOW to get a track
   * (getUserMedia, or an uploaded <video>'s captureStream()), but this class
   * owns WHEN. Once it returns one, this class owns stopping it, in
   * stop()/dispose(). Resolves when the loop is actually running; the
   * 'ready' receipt fires part-way through, before the source is touched.
   */
  async start(
      acquireTrack: () => Promise<MediaStreamTrack>, backend: Backend, litertVersion: string,
      callbacks: StartCallbacks, onProgress?: (message: string) => void): Promise<void> {
    const modelBytes = await this.loadModelBytes(onProgress, callbacks.onLog);

    this.detachSessionListener();
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
        this.resolveReady?.();
      } else if (msg.type === 'stats') {
        callbacks.onStats(msg.inferenceMs, msg.fps);
      } else if (msg.type === 'error') {
        callbacks.onError(msg.message);
        this.rejectReady?.(new Error(msg.message));
      }
      // 'stopped' is handled by stop()'s own listener, not here — this
      // listener stays registered for the whole live session.
    };
    this.sessionListener = onMessage;
    this.worker.addEventListener('message', onMessage);

    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    onProgress?.('compiling model…');
    const compileMsg: MainToLiveWorkerMessage = {
      type: 'compile', backend, litertVersion, modelBytes: modelBytes.slice(0),
    };
    this.worker.postMessage(compileMsg, [compileMsg.modelBytes]);
    await ready;

    // Compiled and ready — start the camera / video only now.
    onProgress?.('starting video source…');
    let track: MediaStreamTrack;
    try {
      track = await acquireTrack();
    } catch (e) {
      // The worker is parked holding a compiled model waiting for 'attach';
      // release it or it never acknowledges a later stop.
      this.worker.postMessage({type: 'stop'} satisfies MainToLiveWorkerMessage);
      throw e;
    }
    this.track = track;

    // Constructed here (not in the worker) because MediaStreamTrackProcessor
    // needs the actual track, which never leaves this thread — only its
    // .readable stream (transferable) is handed over below.
    const processor = new MediaStreamTrackProcessor({track});
    const attachMsg: MainToLiveWorkerMessage = {type: 'attach', readable: processor.readable};
    this.worker.postMessage(attachMsg, [attachMsg.readable]);
  }

  /** Without this, every start() left its listener attached and `onStats`
   *  fired once per past session on every message — the metric row visibly
   *  thrashed after a few backend switches. */
  private detachSessionListener(): void {
    if (this.sessionListener) this.worker.removeEventListener('message', this.sessionListener);
    this.sessionListener = null;
  }

  /** Stops the live loop and releases the track. The track is stopped
   *  right here on the main thread (see class doc comment) — resolving
   *  waits only on the worker's 'stopped' to confirm its own resources
   *  (reader, compiled model) are released, so the caller can safely start
   *  a different backend or source once this resolves. */
  stop(): Promise<void> {
    this.track?.stop();
    this.track = null;
    this.detachSessionListener();
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
    this.detachSessionListener();
    // Best effort — a page unload doesn't get to wait for 'stopped'.
    const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
    this.worker.postMessage(stopMsg);
    this.worker.terminate();
  }
}
