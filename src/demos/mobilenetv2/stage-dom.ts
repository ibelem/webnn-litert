import {findDemo} from '../../registry';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {formatProgress, readWithProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage, RenderDataMessage} from '../../runner/worker-protocol';
import type {MobilenetLabels} from './render';
import MobilenetWorker from './worker-entry.ts?worker';

const found = findDemo('mobilenetv2');
if (!found) throw new Error('registry missing mobilenetv2 entry');
const DEMO = found;
if (!DEMO.model.labels) throw new Error('registry mobilenetv2 entry has no labels URL');
const LABELS_URL = DEMO.model.labels;

export interface RunParams {
  backend: Backend;
  litertVersion: string;
  iterations: number;
  warmupRuns: number;
  onProgress?: (message: string) => void;
}

/**
 * DOM-based stage for MobileNetV2 classification. Renders results as HTML
 * elements instead of canvas, making the text accessible and easier to style.
 */
export class MobilenetDomStage {
  private readonly container: HTMLElement;
  private readonly worker: Worker;
  private readonly scheduler = new MeasurementScheduler();
  private modelBytesCache: ArrayBuffer | null = null;
  private labelsCache: readonly string[] | null = null;
  private nextRequestId = 0;
  private pendingRenderData: RenderDataMessage | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.worker = new MobilenetWorker();
    const init: MainToWorkerMessage = {type: 'init', canvas: new OffscreenCanvas(1, 1), domMode: true};
    this.worker.postMessage(init, [init.canvas]);
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

  private async loadLabels(): Promise<readonly string[]> {
    if (this.labelsCache) return this.labelsCache;
    const res = await fetchModelWithMirrorFallback(LABELS_URL);
    if (!res.ok) throw new Error(`labels fetch ${res.status} — ${LABELS_URL}`);
    this.labelsCache = (await res.text()).split('\n').map((s) => s.trim());
    return this.labelsCache;
  }

  private async loadSourceImage(): Promise<ImageBitmap> {
    const res = await fetch('/images/sample-dog.jpg');
    if (!res.ok) throw new Error(`sample image fetch ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  /**
   * Render classification results as HTML elements.
   */
  private renderResults(data: RenderDataMessage): void {
    const labels = data.extra as MobilenetLabels;
    const output = data.data['MobilenetV2/Predictions/Reshape_1'];
    if (!output) throw new Error('missing output tensor');

    // Get top 5 predictions
    const scores = Array.from(output).map((score, i) => ({score, label: labels.labels[i]}));
    scores.sort((a, b) => b.score - a.score);
    const top5 = scores.slice(0, 5);

    // Build HTML
    this.container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'classification-results';

    top5.forEach((item, rank) => {
      const row = document.createElement('div');
      row.className = 'classification-row';
      row.innerHTML = `
        <span class="classification-rank">${rank + 1}</span>
        <span class="classification-label">${item.label}</span>
        <span class="classification-score">${item.score.toFixed(2)}</span>
      `;
      list.appendChild(row);
    });

    this.container.appendChild(list);
  }

  async run(params: RunParams): Promise<RunRecord> {
    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');

    const [cachedModel, labels] = await Promise.all([
      this.loadModelBytes(params.onProgress),
      this.loadLabels(),
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
        if (msg.type === 'record') {
          // Render results if we have pending render data
          if (this.pendingRenderData) {
            this.renderResults(this.pendingRenderData);
            this.pendingRenderData = null;
          }
          resolve(msg.record);
        } else if (msg.type === 'render-data') {
          // Store render data for when record arrives
          this.pendingRenderData = msg;
        } else if (msg.type === 'worker-error') {
          reject(new Error(msg.message));
        }
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
        extra: labels,
      };
      this.worker.postMessage(runMsg, [image]);
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}