import {findDemo} from '../../registry';
import {loadModelBytesCached} from '../../runner/opfs-cache';
import {formatProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage} from '../../runner/worker-protocol';
// Vite's dedicated Worker import — NOT `new Worker(new URL('./worker-entry.ts',
// import.meta.url))`. That raw pattern only gets IIFE bundling at build time;
// in `vite dev` it serves untransformed ESM into a classic worker context and
// throws "Cannot use import statement outside a module". The `?worker` suffix
// (combined with `worker.format: 'iife'` in vite.config.ts) produces a
// correctly-bundled classic worker in BOTH dev and build — required because
// LiteRT's Emscripten loader calls importScripts(), which module workers
// reject outright.
import DepthAnythingWorker from './worker-entry.ts?worker';

const found = findDemo('depth-anything');
if (!found) throw new Error('registry missing depth-anything entry');
// Narrowing from the guard above doesn't persist into methods defined later
// in the module (TS's control-flow analysis doesn't track that a `const`
// closure captured after a throw-guard can never see the pre-guard type) —
// rebind to a definitely-typed const instead of asserting `!` at each use.
const DEMO = found;

export interface RunParams {
  backend: Backend;
  litertVersion: string;
  iterations: number;
  warmupRuns: number;
  onProgress?: (message: string) => void;
  onLog?: (message: string) => void;
}

/**
 * Owns the demo's canvas, worker and model cache. `transferControlToOffscreen()`
 * happens exactly once, in the constructor — after that the main thread can
 * never draw to or resize this canvas again (see CLAUDE.md, the
 * element-identity rule). Never rebuild this instance's canvas.
 *
 * Cross-worker cancellation of an in-flight run is intentionally NOT
 * implemented: AbortSignal is not reliably transferable across postMessage
 * in Chrome M153. `MeasurementScheduler` instead discards a stale run's
 * *result* when a newer one supersedes it — correctness without needing true
 * cancellation. A truly hung worker only costs the visitor a wasted
 * background computation, not a wrong or stale render.
 */
export class DepthAnythingStage {
  private readonly worker: Worker;
  private readonly scheduler = new MeasurementScheduler();
  private modelBytesCache: ArrayBuffer | null = null;
  private nextRequestId = 0;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new DepthAnythingWorker();
    const init: MainToWorkerMessage = {type: 'init', canvas: offscreen};
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

  private async loadSourceImage(): Promise<ImageBitmap> {
    const res = await fetch('/images/sample-dog.jpg');
    if (!res.ok) throw new Error(`sample image fetch ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  /**
   * Runs one backend and resolves with its RunRecord. Switching backend
   * before a run finishes supersedes it: the superseded run's result (or
   * error) is silently discarded rather than applied to the display.
   */
  async run(params: RunParams): Promise<RunRecord> {
    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');

    // Cached: repeat runs on this stage instance (different backend, same
    // demo) don't refetch tens of MB of model each time.
    const cached = await this.loadModelBytes(params.onProgress, params.onLog);
    if (signal.aborted) throw abortedError();
    // Transfer consumes the buffer, so send a fresh copy — never the cache.
    const modelBytes = cached.slice(0);

    params.onProgress?.('loading image…');
    const image = await this.loadSourceImage();
    if (signal.aborted) {
      image.close();
      throw abortedError();
    }

    params.onProgress?.(`measuring ${params.backend}…`);
    return new Promise<RunRecord>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
        const msg = event.data;
        if (msg.requestId !== requestId) return; // response to a superseded run
        if (msg.type === 'log') {
          params.onLog?.(msg.message);
          return;
        }
        this.worker.removeEventListener('message', onMessage);
        if (!isCurrent()) {
          reject(abortedError());
          return;
        }
        if (msg.type === 'record') resolve(msg.record);
        else if (msg.type === 'worker-error') reject(new Error(msg.message));
        else reject(new Error(`unexpected message type: ${msg.type}`));
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
    this.worker.terminate();
  }
}
