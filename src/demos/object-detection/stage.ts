import {findDemo} from '../../registry';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {formatProgress, readWithProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage} from '../../runner/worker-protocol';
import {getCurrentImageSrc} from '../../ui/image-upload';
import Yolo26Worker from './worker-entry.ts?worker';

const found = findDemo('object-detection');
if (!found) throw new Error('registry missing object-detection entry');
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
 * YOLO26 stage manages the worker lifecycle and runs inference.
 * 
 * This follows the same pattern as MobilenetStage:
 * - Creates a worker with OffscreenCanvas
 * - Caches model bytes and labels
 * - Uses MeasurementScheduler to handle concurrent runs
 * - Sends run messages to worker and receives RunRecord results
 */
export class Yolo26Stage {
  private readonly worker: Worker;
  private readonly scheduler = new MeasurementScheduler();
  private modelBytesCache: ArrayBuffer | null = null;
  private nextRequestId = 0;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new Yolo26Worker();
    const init: MainToWorkerMessage = {type: 'init', canvas: offscreen};
    this.worker.postMessage(init, [offscreen]);
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

  private async loadSourceImage(): Promise<ImageBitmap> {
    const res = await fetch(getCurrentImageSrc());
    if (!res.ok) throw new Error(`sample image fetch ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  async run(params: RunParams): Promise<RunRecord> {
    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');

    const modelBytes = (await this.loadModelBytes(params.onProgress)).slice(0);
    if (signal.aborted) throw abortedError();

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
        if (msg.requestId !== requestId) return;
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