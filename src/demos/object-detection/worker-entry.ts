/**
 * Worker entry for yolo26. MUST stay a classic worker (imported via
 * `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader calls
 * importScripts(), which module workers reject. See
 * demos/depth-anything/worker-entry.ts for the full explanation.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessYolo26} from './preprocess';
import {renderYolo26} from './render';

runDemoWorker({
  preprocess: preprocessYolo26,
  render: renderYolo26,
});