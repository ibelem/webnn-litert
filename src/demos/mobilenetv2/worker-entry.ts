/**
 * Worker entry for mobilenetv2. MUST stay a classic worker (imported via
 * `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader calls
 * importScripts(), which module workers reject. See
 * demos/depth-anything/worker-entry.ts for the full explanation.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessMobilenetv2} from './preprocess';
import {renderMobilenetv2} from './render';

runDemoWorker({
  preprocess: preprocessMobilenetv2,
  render: renderMobilenetv2,
});
