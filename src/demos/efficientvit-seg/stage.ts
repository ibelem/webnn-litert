import {findDemo} from '../../registry';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {formatProgress, readWithProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage} from '../../runner/worker-protocol';
import type {Ade20kPalette} from './render';
import EfficientVitWorker from './worker-entry.ts?worker';

const found = findDemo('efficientvit-seg');
if (!found) throw new Error('registry missing efficientvit-seg entry');
const DEMO = found;

/** Ported verbatim from the reference's ade20k_class_colors.json — see
 *  public/data/ade20k_class_colors.json and DESIGN.md's "search before
 *  building": copied, not re-derived. */
const PALETTE_URL = '/data/ade20k_class_colors.json';

export interface RunParams {
  backend: Backend;
  litertVersion: string;
  iterations: number;
  warmupRuns: number;
  onProgress?: (message: string) => void;
}

/** Same shape as the other stages; see DepthAnythingStage for the full
 *  canvas/worker/cancellation commentary. */
export class EfficientVitStage {
  private readonly worker: Worker;
  private readonly scheduler = new MeasurementScheduler();
  private modelBytesCache: ArrayBuffer | null = null;
  private paletteCache: ReadonlyArray<readonly [number, number, number]> | null = null;
  private nextRequestId = 0;

  constructor(canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new EfficientVitWorker();
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

  private async loadPalette(): Promise<ReadonlyArray<readonly [number, number, number]>> {
    if (this.paletteCache) return this.paletteCache;
    // Same-origin static asset, not huggingface.co — no mirror fallback needed.
    const res = await fetch(PALETTE_URL);
    if (!res.ok) throw new Error(`palette fetch ${res.status} — ${PALETTE_URL}`);
    const json = await res.json() as {colors: Array<[number, number, number]>};
    this.paletteCache = json.colors;
    return this.paletteCache;
  }

  private async loadSourceImage(): Promise<ImageBitmap> {
    const res = await fetch('/images/sample-dog.jpg');
    if (!res.ok) throw new Error(`sample image fetch ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  async run(params: RunParams): Promise<RunRecord> {
    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');

    const [cachedModel, colors] = await Promise.all([
      this.loadModelBytes(params.onProgress),
      this.loadPalette(),
    ]);
    if (signal.aborted) throw abortedError();
    const modelBytes = cachedModel.slice(0);

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
        this.worker.removeEventListener('message', onMessage);
        if (!isCurrent()) {
          reject(abortedError());
          return;
        }
        if (msg.type === 'record') resolve(msg.record);
        else reject(new Error(msg.message));
      };
      this.worker.addEventListener('message', onMessage);

      const extra: Ade20kPalette = {colors};
      const runMsg: MainToWorkerMessage = {
        type: 'run',
        requestId,
        backend: params.backend,
        litertVersion: params.litertVersion,
        modelBytes,
        iterations: params.iterations,
        warmupRuns: params.warmupRuns,
        image,
        extra,
      };
      this.worker.postMessage(runMsg, [modelBytes, image]);
    });
  }

  dispose(): void {
    this.scheduler.cancelCurrent();
    this.worker.terminate();
  }
}
