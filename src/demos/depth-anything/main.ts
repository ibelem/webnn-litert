import {DEFAULT_LITERT_VERSION} from '../../runner/loader';
import {createCompareController} from '../../runner/compare-controller';
import {DEFAULT_BACKEND} from '../../runner/types';
import {DepthAnythingStage} from './stage';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from depth-anything.html`);
  return node as T;
}

const params = new URLSearchParams(location.search);
const litertVersion = params.get('litertjs') ?? DEFAULT_LITERT_VERSION;

const controller = createCompareController({
  statusEl: el('status'),
  gridEl: el('compare-grid'),
  backendBoxes: [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')],
  litertVersion,
  createStage: (canvas) => new DepthAnythingStage(canvas),
});

controller.applyUrlBackendSelection(DEFAULT_BACKEND);

for (const box of document.querySelectorAll<HTMLInputElement>('input[name="backend"]')) {
  box.addEventListener('change', () => void controller.runAll());
}

void controller.runAll();

window.addEventListener('beforeunload', () => controller.dispose());
