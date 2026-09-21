/**
 * Thin binding of the shared LiveStage to this demo's worker and model.
 * Behaviour lives in runner/live-stage.ts — see it for the camera-lifecycle
 * and compile-before-source invariants.
 */
import {findDemo} from '../../registry';
import {LiveStage} from '../../runner/live-stage';
import {getLocalModel} from '../../ui/model-upload';
import Yolo26LiveWorker from './worker-entry-live.ts?worker';

const found = findDemo('object-detection');
if (!found) throw new Error('registry missing object-detection entry');
const DEMO = found;

export class ObjectDetectionLiveStage extends LiveStage {
  constructor(canvas: HTMLCanvasElement) {
    // getLocalModel is consulted per start(), so an "Upload Model" pick made
    // after this stage was constructed still reaches the next session.
    super(canvas, new Yolo26LiveWorker(), DEMO.model.url, {resolveLocalModel: getLocalModel});
  }
}
