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
  onStats: (inferenceMs: number) => void;
  onLog?: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Continuous webcam segmentation, one backend at a time — not built on
 * runner/measure.ts's discrete-N-iteration shape (see worker-entry.ts).
 * Parallels SelfieMulticlassStage's care about releasing the camera
 * promptly, but for a held-open track instead of one snapshot: once the
 * track is transferred to the worker (postMessage's transfer list detaches
 * it from this realm), the worker's own `track.stop()` in its 'stop'/error
 * cleanup is what actually releases the camera — this class has no live
 * reference to stop after that point, only before it.
 */
export class EfficientVitLiveStage {
  private readonly worker: Worker;
  private modelBytesCache: ArrayBuffer | null = null;

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
   * Requests camera access (needs the caller's user-gesture context — call
   * from a click handler), compiles the model, and starts the live loop.
   * Resolves once the 'ready' receipt has arrived; the loop itself keeps
   * running and calling `callbacks.onStats` until stop().
   */
  async start(
      backend: Backend, litertVersion: string, callbacks: StartCallbacks,
      onProgress?: (message: string) => void): Promise<void> {
    onProgress?.('requesting camera…');
    const stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
    const [track] = stream.getVideoTracks();
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error('getUserMedia returned no video track');
    }

    let modelBytes: ArrayBuffer;
    try {
      modelBytes = await this.loadModelBytes(onProgress, callbacks.onLog);
    } catch (e) {
      track.stop(); // never transferred — this is the only reference to it
      throw e;
    }

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
        // listener stays registered for the whole live session (stats keep
        // arriving after start() resolves), so it can't also be the one
        // that resolves stop()'s promise without racing it.
      };
      this.worker.addEventListener('message', onMessage);

      const startMsg: MainToLiveWorkerMessage = {
        type: 'start', backend, litertVersion, modelBytes: modelBytes.slice(0), track,
      };
      // track transfers here — the worker owns the live reference from this
      // point on; this class has nothing left to release.
      this.worker.postMessage(startMsg, [startMsg.modelBytes, track]);
    });
  }

  /** Stops the live loop and releases the camera (in the worker — see class
   *  doc comment). Resolves once the worker confirms via 'stopped'; the
   *  caller should wait for this before starting a different backend, so
   *  two loops never overlap. */
  stop(): Promise<void> {
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
    // Best effort — a page unload doesn't get to wait for 'stopped'.
    // Terminating the worker also tears down whatever camera resource it
    // held as a safety net if the message never gets processed in time.
    const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
    this.worker.postMessage(stopMsg);
    this.worker.terminate();
  }
}
