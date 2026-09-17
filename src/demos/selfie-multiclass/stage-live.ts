/**
 * Thin binding of the shared LiveStage to this demo's worker and model.
 * Behaviour lives in runner/live-stage.ts — see it for the camera-lifecycle
 * and compile-before-source invariants.
 *
 * Note the contrast with stage.ts in this same folder: that one is the
 * SNAPSHOT path (one frame, camera released immediately, N backends compared
 * on the same still). This is the continuous path — one backend, camera held
 * open, frames until stopped.
 */
import {findDemo} from '../../registry';
import {LiveStage} from '../../runner/live-stage';
import SelfieMulticlassLiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('selfie-multiclass');
if (!found) throw new Error('registry missing selfie-multiclass entry');
const DEMO = found;

export class SelfieMulticlassLiveStage extends LiveStage {
  constructor(canvas: HTMLCanvasElement) {
    super(canvas, new SelfieMulticlassLiveWorker(), DEMO.model.url);
  }
}
