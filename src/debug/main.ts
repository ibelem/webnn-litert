/**
 * Debug harness page. Drives src/runner/ directly, with no visual stage.
 *
 * This is the raw delegation-truth tool: arbitrary model x LiteRT.js version x
 * backend, showing what actually ran. It is what you attach to a LiteRT bug
 * report, and it is what a version sweep uses. Demo pages share the same
 * runner but present it visually with exactly two metrics.
 */
import {DEMOS} from '../registry';
import {readEnvironment} from '../runner/env';
import {DEFAULT_LITERT_VERSION, isValidVersion} from '../runner/loader';
import {measureBackend} from '../runner/measure';
import {BACKENDS, isBackend, type Backend, type RunRecord} from '../runner/types';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from debug.html`);
  return node as T;
}

const versionInput = el<HTMLInputElement>('version');
const itersInput = el<HTMLInputElement>('iters');
const warmupInput = el<HTMLInputElement>('warmup');
const modelSelect = el<HTMLSelectElement>('model');
const backendBoxes = el<HTMLSpanElement>('backend-boxes');
const runButton = el<HTMLButtonElement>('run');
const cancelButton = el<HTMLButtonElement>('cancel');
const statusEl = el<HTMLSpanElement>('status');
const resultsEl = el<HTMLTableSectionElement>('results');
const logEl = el<HTMLDivElement>('log');
const envEl = el<HTMLDivElement>('env');
const isolationWarning = el<HTMLDivElement>('isolation-warning');

// ---------------------------------------------------------------- controls

for (const demo of DEMOS) {
  const option = document.createElement('option');
  option.value = demo.slug;
  option.textContent = demo.title;
  modelSelect.append(option);
}

// Default checked: the three accelerated backends. wasm is opt-in, as on the
// real site — it is a baseline, not a peer.
for (const backend of BACKENDS) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = backend;
  box.checked = backend !== 'wasm';
  box.dataset.role = 'backend';
  label.append(box, document.createTextNode(` ${backend}`));
  backendBoxes.append(label);
}

// URL params use the same names as the real site: ?litertjs= &model= &backend=
const params = new URLSearchParams(location.search);
const urlVersion = params.get('litertjs');
versionInput.value =
    urlVersion && isValidVersion(urlVersion) ? urlVersion : DEFAULT_LITERT_VERSION;
if (urlVersion && !isValidVersion(urlVersion)) {
  statusEl.textContent = `ignored &litertjs=${urlVersion} — not valid semver`;
}

const urlModel = params.get('model');
if (urlModel && DEMOS.some((d) => d.slug === urlModel)) modelSelect.value = urlModel;

const urlBackends = params.get('backend')?.split(',').map((s) => s.trim()).filter(isBackend);
if (urlBackends?.length) {
  for (const box of backendCheckboxes()) {
    box.checked = urlBackends.includes(box.value as Backend);
  }
}

function backendCheckboxes(): HTMLInputElement[] {
  return [...backendBoxes.querySelectorAll<HTMLInputElement>('input[data-role="backend"]')];
}

// ---------------------------------------------------------------- environment

void (async () => {
  const env = await readEnvironment();
  envEl.textContent = [
    `crossOriginIsolated : ${env.crossOriginIsolated}`,
    `SharedArrayBuffer   : ${env.sharedArrayBuffer}`,
    `navigator.ml (WebNN): ${env.webnn}`,
    `navigator.gpu       : ${env.webgpu}`,
    `hardwareConcurrency : ${env.hardwareConcurrency}`,
    `browser             : ${env.browser}`,
    `gpu adapter         : ${env.gpuAdapter}`,
  ].join('\n');

  // If isolation is missing, threaded WASM degrades silently and the CPU
  // baseline becomes unfairly slow. Say so rather than publishing the number.
  if (!env.crossOriginIsolated) {
    isolationWarning.hidden = false;
    isolationWarning.textContent =
        'Not cross-origin isolated: COOP/COEP headers are missing, so threaded WASM ' +
        'will run single-threaded and the wasm baseline will look slower than it is. ' +
        'Check vercel.json in production, or vite.config.ts locally.';
  }
})();

// ---------------------------------------------------------------- rendering

const ms = (n: number) => n.toFixed(1);

const DELEGATION_TEXT = {
  full: 'fully delegated',
  partial: 'partially delegated — some ops on CPU',
  failed: 'did not run',
} as const;

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function renderRow(record: RunRecord): void {
  const tr = document.createElement('tr');
  tr.dataset.backend = record.backend;

  const chipCell = document.createElement('td');
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = record.backend;
  chipCell.append(chip);
  tr.append(chipCell);

  tr.append(cell(DELEGATION_TEXT[record.delegation], `deleg-${record.delegation}`));

  if (!record.metrics) {
    const errorCell = cell(record.error ?? 'unknown error', 'suppressed');
    errorCell.colSpan = 4;
    tr.append(errorCell);
    resultsEl.append(tr);
    return;
  }

  // Latency from a partial delegation is not a WebNN number. Shown for
  // completeness, styled so it can never read as a headline.
  const numClass = record.delegation === 'full' ? 'num' : 'num suppressed';
  const m = record.metrics;
  tr.append(
      cell(ms(m.load_and_compile_ms), numClass),
      cell(ms(m.first_inference_ms), numClass),
      cell(ms(m.median_ms), numClass),
      cell(ms(m.p90_ms), numClass),
  );
  resultsEl.append(tr);
}

function appendLog(backend: string, lines: readonly string[]): void {
  if (!lines.length) return;
  if (logEl.textContent === '(nothing yet)') logEl.textContent = '';
  logEl.textContent += `--- ${backend} ---\n${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- run

/**
 * Coerces a numeric input to a safe positive integer. `<input min="1">` is a
 * UI hint the browser shows, not a guarantee — clearing the field reads back
 * as `Number('') === 0`, which previously reached computeMetrics as a
 * zero-length sample array and threw its guard three calls downstream. Clamp
 * at the read site so a blank field means "use 1", not a confusing error.
 */
function clampPositiveInt(raw: string, fallback: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

let activeRun: AbortController | null = null;

runButton.addEventListener('click', () => void run());
cancelButton.addEventListener('click', () => activeRun?.abort());

async function run(): Promise<void> {
  const version = versionInput.value.trim();
  const iterations = clampPositiveInt(itersInput.value, 1);
  const warmupRuns = Math.max(0, Math.floor(Number(warmupInput.value)) || 0);
  const backends = backendCheckboxes().filter((b) => b.checked).map((b) => b.value as Backend);
  const demo = DEMOS.find((d) => d.slug === modelSelect.value);

  resultsEl.replaceChildren();
  logEl.textContent = '(nothing yet)';

  if (!demo) {
    statusEl.textContent = 'no model selected';
    return;
  }
  if (!isValidVersion(version)) {
    statusEl.textContent = `"${version}" is not valid semver — refusing to load it`;
    return;
  }
  if (!backends.length) {
    statusEl.textContent = 'select at least one backend';
    return;
  }

  const controller = new AbortController();
  activeRun = controller;
  const {signal} = controller;

  runButton.disabled = true;
  cancelButton.hidden = false;
  try {
    statusEl.textContent = 'fetching model…';
    const res = await fetch(demo.model.url, {signal});
    if (!res.ok) throw new Error(`model fetch ${res.status} — ${demo.model.url}`);
    const modelBytes = new Uint8Array(await res.arrayBuffer());

    // Serial by construction: concurrent backends contend for memory bandwidth
    // and thermal headroom and corrupt each other's timings.
    for (const backend of backends) {
      statusEl.textContent = `measuring ${backend}…`;
      const record = await measureBackend(
          backend, version, modelBytes, iterations, warmupRuns, {signal});
      renderRow(record);
      appendLog(backend, record.warnings);
      if (record.error) appendLog(backend, [`[error] ${record.error}`]);

      // Full record to the console — everything the page does not show.
      console.log(backend, record);
    }
    statusEl.textContent = `done — ${demo.title} on @litertjs/core@${version}`;
  } catch (e) {
    // A programmer error (bad argument, null dereference, out-of-range index)
    // is a real bug and must not be swallowed as "the harness failed" — that
    // hides exactly the kind of silent failure this project exists to expose.
    // measureBackend already re-throws these; propagate rather than catch.
    if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
      throw e;
    }
    const message = signal.aborted ? 'cancelled' :
        e instanceof Error ? e.message : String(e);
    statusEl.textContent = signal.aborted ? 'cancelled' : `failed: ${message}`;
    if (!signal.aborted) appendLog('harness', [`[error] ${message}`]);
  } finally {
    runButton.disabled = false;
    cancelButton.hidden = true;
    activeRun = null;
  }
}
