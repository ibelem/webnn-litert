/// <reference lib="webworker" />

/**
 * Live (camera / uploaded video) worker entry for efficientvit segmentation.
 * All the machinery lives in runner/live.worker.ts — this file only names the
 * demo's preprocess/render pair and its one-time palette fetch.
 *
 * Shares preprocess with the discrete path but NOT render: live blends the
 * mask over the actual frame, where the still-image path replaces it
 * outright. See render-live.ts for why.
 *
 * MUST stay a classic worker (imported via `?worker`, never
 * `{type: 'module'}`) — LiteRT's Emscripten loader calls importScripts(),
 * which module workers reject.
 */
import {runLiveWorker} from '../../runner/live.worker';
import {preprocessEfficientVit} from './preprocess';
import {renderEfficientVitLive} from './render-live';

const PALETTE_URL = '/data/ade20k_class_colors.json';

runLiveWorker({
  // Fetched ONCE, after compile and before the loop — never per frame.
  // Merged into `extra`, which render receives as {colors, frame}.
  prepare: async () => {
    const res = await fetch(PALETTE_URL);
    if (!res.ok) throw new Error(`palette fetch ${res.status} — ${PALETTE_URL}`);
    const {colors} = await res.json() as {colors: Array<[number, number, number]>};
    return {colors};
  },
  preprocess: preprocessEfficientVit,
  render: renderEfficientVitLive,
});
