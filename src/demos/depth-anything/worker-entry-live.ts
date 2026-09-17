/// <reference lib="webworker" />

/**
 * Live (camera / uploaded video) worker entry for depth-anything. All the
 * machinery lives in runner/live.worker.ts — this file only names the demo's
 * preprocess/render pair, exactly as worker-entry.ts does for the discrete
 * compare-grid path via runDemoWorker.
 *
 * No `prepare` step and no use of `extra`: the depth map replaces the source
 * frame entirely rather than being drawn over it, so unlike object-detection
 * this demo never needs the frame back at render time.
 *
 * MUST stay a classic worker (imported via `?worker`, never
 * `{type: 'module'}`) — LiteRT's Emscripten loader calls importScripts(),
 * which module workers reject.
 */
import {runLiveWorker} from '../../runner/live.worker';
import {preprocessDepthAnything} from './preprocess';
import {renderDepthAnything} from './render';

runLiveWorker({
  preprocess: preprocessDepthAnything,
  render: renderDepthAnything,
});
