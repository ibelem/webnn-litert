/**
 * Worker entry for efficientvit-seg. MUST stay a classic worker (imported
 * via `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader
 * calls importScripts(), which module workers reject. See
 * demos/depth-anything/worker-entry.ts for the full explanation.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessEfficientVit} from './preprocess';
import {renderEfficientVit} from './render';

runDemoWorker({
  preprocess: preprocessEfficientVit,
  render: renderEfficientVit,
});
