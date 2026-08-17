import {findDemo} from '../../registry';
import {fetchWithRetry} from '../../runner/fetch-retry';
import {formatProgress, readWithProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage} from '../../runner/worker-protocol';

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
    // MUST be a classic worker (no `type: 'module'`). LiteRT's Emscripten
    // WASM loader calls importScripts() internally, and module workers throw
    // "Module scripts don't support importScripts()" the moment that runs —
    // confirmed against web-ai-run's inference.worker.ts, which carries the
    // same constraint verbatim. Vite still bundles worker-entry.ts's static
    // imports away into a plain IIFE for a classic worker; the CDN's dynamic
    // `import()` inside loader.ts is unaffected — dynamic import is a runtime
    // expression available in both classic and module scripts, unlike the
    // synchronous importScripts() API this restriction is actually about.
    this.worker = new Worker(new URL('./worker-entry.ts', import.meta.url));
    const init: MainToWorkerMessage = {type: 'init', canvas: offscreen};
    this.worker.postMessage(init, [offscreen]);
  }

  private async loadModelBytes(onProgress?: (m: string) => void): Promise<ArrayBuffer> {
    if (this.modelBytesCache) return this.modelBytesCache;
    const res = await fetchWithRetry(DEMO.model.url);
    if (!res.ok) throw new Error(`model fetch ${res.status} — ${DEMO.model.url}`);
    const bytes = await readWithProgress(
        res, (p) => onProgress?.(`fetching model… ${formatProgress(p)}`));
    this.modelBytesCache = bytes.buffer as ArrayBuffer;
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
    const cached = await this.loadModelBytes(params.onProgress);
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
    this.worker.terminate();
  }
}
