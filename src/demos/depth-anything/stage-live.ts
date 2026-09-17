/**
 * Thin binding of the shared LiveStage to this demo's worker and model.
 * Behaviour lives in runner/live-stage.ts — see it for the camera-lifecycle
 * and compile-before-source invariants.
 */
import {findDemo} from '../../registry';
import {LiveStage} from '../../runner/live-stage';
import DepthAnythingLiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('depth-anything');
if (!found) throw new Error('registry missing depth-anything entry');
const DEMO = found;

export class DepthAnythingLiveStage extends LiveStage {
  constructor(canvas: HTMLCanvasElement) {
    super(canvas, new DepthAnythingLiveWorker(), DEMO.model.url);
  }
}
