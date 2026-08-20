import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {MobilenetDomStage} from './stage-dom';
import {setupLiteRtVersionDropdown} from '../../ui/litert-version';
import {getInitialInferenceCount, setupInferenceCount} from '../../ui/inference-count';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from mobilenetv2.html`);
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
  createStage: (_canvas) => {
    const container = document.createElement('div');
    container.className = 'classification-container';
    return {
      stage: new MobilenetDomStage(container),
      container,
    };
  },
  // No canvas dimensions needed for DOM-based rendering
  canvasWidth: 0,
  canvasHeight: 0,
});

controller.applyUrlBackendSelection(null);

// Setup LiteRT version dropdown
setupLiteRtVersionDropdown();

// Setup inference count control
setupInferenceCount();

for (const box of document.querySelectorAll<HTMLInputElement>('input[name="backend"]')) {
  box.addEventListener('change', () => void controller.runAll());
}

// setupLiteRtVersionDropdown() dispatches the initial litertVersionChanged
// event that starts the first run — no separate runAll() call here, or
// "select at least one backend" logs twice on every load.

window.addEventListener('beforeunload', () => controller.dispose());
