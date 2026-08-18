/**
 * Worker entry for real-esrgan. MUST stay a classic worker (imported via
 * `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader calls
 * importScripts(), which module workers reject. See
 * demos/depth-anything/worker-entry.ts for the full explanation.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessRealEsrgan} from './preprocess';
import {renderRealEsrgan} from './render';

runDemoWorker({
  preprocess: preprocessRealEsrgan,
  render: renderRealEsrgan,
});
