/**
 * Worker entry for selfie-multiclass. MUST stay a classic worker (imported
 * via `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader calls
 * importScripts(), which module workers reject. See
 * demos/depth-anything/worker-entry.ts for the full explanation; same
 * constraint applies here.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessSelfieMulticlass} from './preprocess';
import {renderSelfieMulticlass} from './render';

runDemoWorker({
  preprocess: preprocessSelfieMulticlass,
  render: renderSelfieMulticlass,
});
