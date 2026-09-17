/**
 * Thin binding of the shared LiveStage to this demo's worker and model.
 * Behaviour lives in runner/live-stage.ts — see it for the camera-lifecycle
 * and compile-before-source invariants.
 */
import {findDemo} from '../../registry';
import {LiveStage} from '../../runner/live-stage';
import EfficientVitLiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('efficientvit-seg');
if (!found) throw new Error('registry missing efficientvit-seg entry');
const DEMO = found;

export class EfficientVitLiveStage extends LiveStage {
  constructor(canvas: HTMLCanvasElement) {
    super(canvas, new EfficientVitLiveWorker(), DEMO.model.url);
  }
}
