import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {RealEsrganStage} from './stage';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';
import {getCurrentImageSize} from '../../ui/image-upload';

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
  // Canvas matches the source image's aspect ratio, capped at 384 on the
  // longer side — this is display sizing only. The model's own fixed tile
  // size (not this canvas) determines actual compute cost, unaffected.
  getSourceSize: getCurrentImageSize,
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
