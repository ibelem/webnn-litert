/**
 * This file IS a Worker entry point — its module identity is what selects
 * "depth-anything" behaviour for the generic runtime in runner/litert.worker.ts.
 * See stage.ts: `new Worker(new URL('./worker-entry.ts', import.meta.url), {type: 'module'})`.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessDepthAnything} from './preprocess';
import {renderDepthAnything} from './render';

runDemoWorker({
  preprocess: preprocessDepthAnything,
  render: renderDepthAnything,
});
