import {findDemo} from '../../registry';
import {loadModelBytesCached} from '../../runner/opfs-cache';
import {formatProgress} from '../../runner/progress-fetch';
import type {Backend, Delegation} from '../../runner/types';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './protocol';
import EfficientVitLiveWorker from './worker-entry.ts?worker';

const found = findDemo('efficientvit-live');
if (!found) throw new Error('registry missing efficientvit-live entry');
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
 * Continuous webcam segmentation, one backend at a time — not built on
 * runner/measure.ts's discrete-N-iteration shape (see worker-entry.ts).
 *
 * MediaStreamTrack itself is NOT transferable (Chrome throws "does not
 * have a transferable type" on postMessage) — MediaStreamTrackProcessor
 * must be constructed here, on the main thread where the track lives, and
 * only its .readable ReadableStream (which IS transferable) is handed to
 * the worker. That means the track never leaves this class, so — unlike
 * every other camera-lifecycle assumption in worker-entry.ts's first
 * draft — THIS class, not the worker, is what actually calls track.stop()
 * to release the camera. Parallels SelfieMulticlassStage's care about
 * releasing promptly, just with a held-open track instead of one snapshot.
 */
export class EfficientVitLiveStage {
  private readonly worker: Worker;
  private modelBytesCache: ArrayBuffer | null = null;
  private track: MediaStreamTrack | null = null;
  private sessionListener: ((event: MessageEvent<LiveWorkerToMainMessage>) => void) | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new EfficientVitLiveWorker();
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
   * Downloads and compiles the model, and ONLY THEN opens the camera and
   * starts the live loop. That order is deliberate: compiling takes ~2s on
   * WebNN, and doing it with the camera already open lit the camera
   * indicator for seconds before a single frame was used. Resolves once the
   * loop is actually running; the 'ready' receipt fires part-way through,
   * before the camera prompt, so the visitor sees what they are about to
   * run on while permission is being asked.
   *
   * getUserMedia does not require transient activation, so it is safe here
   * after an await — but keep the call in a click handler anyway so the
   * permission prompt stays tied to an action the visitor took.
   */
  async start(
      backend: Backend, litertVersion: string, callbacks: StartCallbacks,
      onProgress?: (message: string) => void): Promise<void> {
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
      // listener stays registered for the whole live session (stats keep
      // arriving after start() resolves), so it can't also be the one
      // that resolves stop()'s promise without racing it.
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

    // Compiled and ready — open the camera only now.
    onProgress?.('requesting camera…');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
    } catch (e) {
      // The worker is parked holding a compiled model waiting for 'attach';
      // release it or it never acknowledges a later stop.
      this.worker.postMessage({type: 'stop'} satisfies MainToLiveWorkerMessage);
      throw e;
    }
    const [track] = stream.getVideoTracks();
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      this.worker.postMessage({type: 'stop'} satisfies MainToLiveWorkerMessage);
      throw new Error('getUserMedia returned no video track');
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

  /** Stops the live loop and releases the camera. The track is stopped
   *  right here on the main thread (see class doc comment) — resolving
   *  waits only on the worker's 'stopped' to confirm ITS resources (reader,
   *  compiled model) are released too, so the caller can safely start a
   *  different backend once this resolves without two loops overlapping. */
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
