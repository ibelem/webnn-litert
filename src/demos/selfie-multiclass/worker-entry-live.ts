/// <reference lib="webworker" />

/**
 * Live (camera / uploaded video) worker entry for selfie-multiclass. All the
 * machinery lives in runner/live.worker.ts — this file only names the demo's
 * preprocess/render pair, exactly as worker-entry.ts does for the discrete
 * snapshot compare path via runDemoWorker.
 *
 * No `prepare` step and no use of `extra`: the mask is drawn over a solid
 * backdrop rather than composited onto the source frame (see render.ts), so
 * unlike object-detection this demo never needs the frame back at render time.
 *
 * MUST stay a classic worker (imported via `?worker`, never
 * `{type: 'module'}`) — LiteRT's Emscripten loader calls importScripts(),
 * which module workers reject.
 */
import {runLiveWorker} from '../../runner/live.worker';
import {preprocessSelfieMulticlass} from './preprocess';
import {renderSelfieMulticlass} from './render';

runLiveWorker({
  preprocess: preprocessSelfieMulticlass,
  render: renderSelfieMulticlass,
});
