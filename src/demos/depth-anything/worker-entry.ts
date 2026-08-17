/**
 * This file IS a Worker entry point — its module identity is what selects
 * "depth-anything" behaviour for the generic runtime in runner/litert.worker.ts.
 * See stage.ts: `new Worker(new URL('./worker-entry.ts', import.meta.url))`.
 *
 * MUST stay a classic worker (no `{type: 'module'}` at the construction
 * site). LiteRT's Emscripten WASM loader calls importScripts() internally,
 * which module workers reject outright ("Module scripts don't support
 * importScripts()"). Vite still bundles this file's own static imports away
 * into a plain IIFE when constructed as a classic worker — write normal
 * ESM here, just never add `{type: 'module'}` to the `new Worker(...)` call.
 */
import {runDemoWorker} from '../../runner/litert.worker';
import {preprocessDepthAnything} from './preprocess';
import {renderDepthAnything} from './render';

runDemoWorker({
  preprocess: preprocessDepthAnything,
  render: renderDepthAnything,
});
