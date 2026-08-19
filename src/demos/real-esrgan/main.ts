import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {DEFAULT_BACKEND} from '../../runner/types';
import {RealEsrganStage} from './stage';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {setupInferenceCount} from '../../ui/inference-count';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from real-esrgan.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

const controller = createCompareController({
  statusEl: el('status'),
  gridEl: el('compare-grid'),
  backendBoxes: [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')],
  litertVersion,
  createStage: (canvas) => ({
    stage: new RealEsrganStage(canvas),
    container: canvas,
  }),
  // The output tile is 4x the input, and this is the heaviest demo's
  // readback per iteration — keep the default 384x384 canvas so the compare
  // grid stays a fixed, comparable size; the model's own tile size (not
  // this canvas) determines actual compute cost.
});

controller.applyUrlBackendSelection(DEFAULT_BACKEND);

// Setup LiteRT version dropdown
setupLiteRtVersionDropdown();

// Setup inference count control
setupInferenceCount();

for (const box of document.querySelectorAll<HTMLInputElement>('input[name="backend"]')) {
  box.addEventListener('change', () => void controller.runAll());
}

void controller.runAll();

window.addEventListener('beforeunload', () => controller.dispose());
