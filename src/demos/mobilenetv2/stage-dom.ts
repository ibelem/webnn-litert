import {findDemo} from '../../registry';
import {getCurrentImageSrc} from '../../ui/image-upload';
import {fetchModelWithMirrorFallback} from '../../runner/hf-mirror';
import {loadModelBytesCached} from '../../runner/opfs-cache';
import {formatProgress} from '../../runner/progress-fetch';
import {MeasurementScheduler} from '../../runner/scheduler';
import type {Backend, RunRecord} from '../../runner/types';
import type {MainToWorkerMessage, WorkerToMainMessage, RenderDataMessage} from '../../runner/worker-protocol';
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
  onLog?: (message: string) => void;
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
    this.labelsCache = (await res.text()).split('\n').map((s) => s.trim());
    return this.labelsCache;
  }

  private async loadSourceImage(): Promise<ImageBitmap> {
    const res = await fetch(getCurrentImageSrc());
    if (!res.ok) throw new Error(`sample image fetch ${res.status}`);
    return createImageBitmap(await res.blob());
  }

  /**
   * Render classification results as HTML elements.
   */
  private renderResults(data: RenderDataMessage): void {
    const labels = data.extra as readonly string[];
    const outputName = data.outputDetails[0]?.name;
    if (!outputName) throw new Error('mobilenetv2: model declares no outputs');
    const output = data.data[outputName];
    if (!output) throw new Error(`mobilenetv2: no output data for "${outputName}"`);

    // Get top 5 predictions
    const scores = Array.from(output).map((score, i) => ({score, label: labels[i] ?? `class ${i}`}));
    scores.sort((a, b) => b.score - a.score);
    const top5 = scores.slice(0, 5);

    // Build HTML
    this.container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'classification-results';

    // Built with textContent, not innerHTML: `item.label` comes from a labels
    // file fetched over the network, so interpolating it into markup is an
    // injection sink — and it also mangles any label containing & or <.
    top5.forEach((item, rank) => {
      const row = document.createElement('div');
      row.className = 'classification-row';
      row.append(
          span('classification-rank', String(rank + 1)),
          span('classification-label', item.label),
          span('classification-score', item.score.toFixed(2)));
      list.appendChild(row);
    });

    this.container.appendChild(list);
  }

  async run(params: RunParams): Promise<RunRecord> {
    const {signal, isCurrent} = this.scheduler.start();
    const requestId = String(this.nextRequestId++);
    const abortedError = () => new DOMException('superseded by a newer run', 'AbortError');
    // A superseded run can leave its render-data behind; clearing here stops
    // it being drawn as if it belonged to the run that follows.
    this.pendingRenderData = null;

    const [cachedModel, labels] = await Promise.all([
      this.loadModelBytes(params.onProgress, params.onLog),
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
        if (msg.type === 'log') {
          params.onLog?.(msg.message);
          return;
        }
        if (!isCurrent()) {
          this.worker.removeEventListener('message', onMessage);
          reject(abortedError());
          return;
        }
        if (msg.type === 'record') {
          // Render results if we have pending render data
          if (this.pendingRenderData) {
            this.renderResults(this.pendingRenderData);
            this.pendingRenderData = null;
          }
          this.worker.removeEventListener('message', onMessage);
          resolve(msg.record);
        } else if (msg.type === 'render-data') {
          // Store render data for when record arrives
          this.pendingRenderData = msg;
        } else if (msg.type === 'worker-error') {
          this.worker.removeEventListener('message', onMessage);
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
      // modelBytes MUST be in the transfer list. Omitting it made every run
      // structured-CLONE the whole model into the worker — a second full copy
      // of tens of megabytes, per run, on top of the slice() above. Every
      // other stage transfers it.
      this.worker.postMessage(runMsg, [modelBytes, image]);
    });
  }

  dispose(): void {
    this.scheduler.cancelCurrent();
    this.worker.terminate();
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}
