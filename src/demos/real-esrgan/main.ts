import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {RealEsrganStage} from './stage';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from real-esrgan.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

const controller = createCompareController({
  gridEl: el('compare-grid'),
  backendBoxes: [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')],
  litertVersion,
  iterations: getInitialInferenceCount(),
  logStatusEl: el('log-status'),
  createStage: (canvas) => ({
    stage: new RealEsrganStage(canvas),
    container: canvas,
  }),
  // Sized to the MODEL OUTPUT, not the source image — and deliberately no
  // `getSourceSize`.
  //
  // Both of those were wrong before. The canvas was sized from the source
  // photo and capped at the shared 384 default, so this model's 512x512
  // result was downsampled to ~384x208 on its way to the screen: the one
  // thing a 4x upscaler produces, more pixels, was discarded in the last
  // drawImage of the frame. And the source's aspect ratio is now irrelevant
  // anyway, because preprocess takes a square native-resolution crop rather
  // than squashing the whole photo into the tile.
  //
  // 512 is this model's declared output (128x128 in, 4x). The canvas has to
  // exist before the worker compiles and can never be resized afterwards
  // (transferControlToOffscreen), so it cannot be read from the model — a
  // different model here just means render() scales to fit, which degrades
  // sharpness but does not break.
  canvasWidth: 512,
  canvasHeight: 512,
});

controller.applyUrlBackendSelection(null);

// Setup LiteRT version dropdown
setupLiteRtVersionDropdown();

// Setup inference count control
setupInferenceCount();

// NOTE: no backend `change` listener here on purpose. createCompareController
// already registers one (see its own comment); adding a second made one tick
// fire two passes and measure every backend twice.

// setupLiteRtVersionDropdown() dispatches the initial litertVersionChanged
// event that starts the first run — no separate runAll() call here, or
// "select at least one backend" logs twice on every load.

window.addEventListener('beforeunload', () => controller.dispose());
