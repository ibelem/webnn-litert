/// <reference lib="webworker" />

/**
 * Live (camera / uploaded video) worker entry for yolo26. All the machinery
 * lives in runner/live.worker.ts — this file only names the demo's
 * preprocess/render pair, exactly as worker-entry.ts does for the discrete
 * compare-grid path via runDemoWorker.
 *
 * MUST stay a classic worker (imported via `?worker`, never
 * `{type: 'module'}`) — LiteRT's Emscripten loader calls importScripts(),
 * which module workers reject.
 */
import {runLiveWorker} from '../../runner/live.worker';
import {preprocessYolo26} from './preprocess';
import {renderYolo26} from './render';

runLiveWorker({
  preprocess: preprocessYolo26,
  render: renderYolo26,
});
