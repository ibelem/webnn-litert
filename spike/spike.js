/*
 * M0 spike — does a .tflite model actually delegate to the backend it claims?
 *
 * Seed of src/runner/ in M1. Three things proven here carry forward:
 *   1. CDN runtime loading with a version parameter (esm.sh + jsDelivr split)
 *   2. Receipt capture: isFullyAccelerated + console.warn interception
 *   3. Serial measurement, one backend at a time
 *
 * KNOWN SPIKE LIMITATION: this runs on the main thread with a single
 * module-global LiteRT instance, loaded with {jspi: true} for every backend.
 * The threaded-WASM baseline is therefore NOT tuned here — treat the `wasm`
 * row as "does it run", not as a fair CPU number. M1 fixes this with one
 * worker per backend, each at its own load mode. See CLAUDE.md.
 */

// Mirrors docs/model.md. Input shapes are read from the model, never hardcoded.
const MODELS = [
  {id: 'mobilenetv2', label: 'torchvision-mobilenet-v2',
   url: 'https://huggingface.co/webnn/torchvision-mobilenet-v2/resolve/main/tflite/model.tflite'},
  {id: 'selfie', label: 'selfie-multiclass-256x256',
   url: 'https://huggingface.co/webnn/selfie-multiclass-256x256/resolve/main/tflite/model.tflite'},
  {id: 'efficientvit', label: 'efficientvit-seg-l2-ade20k-r512x512',
   url: 'https://huggingface.co/webnn/efficientvit-seg-l2-ade20k-r512x512/resolve/main/tflite/model.tflite'},
  {id: 'esrgan', label: 'Real-ESRGAN-x4plus',
   url: 'https://huggingface.co/webnn/Real-ESRGAN-x4plus/resolve/main/tflite/model.tflite'},
  {id: 'depth', label: 'depth-anything-v2-small (wi8_afp32)',
   url: 'https://huggingface.co/webnn/depth-anything-v2-small/resolve/main/tflite/depth_anything_v2_small_wi8_afp32.tflite'},
];

// A version string becomes part of a module URL, so it is untrusted input.
// Without this, `&litertjs=1.0.0/../../@x/evil` walks out of the package and
// import() executes whatever resolves.
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

const COMPILE_OPTS = {
  'wasm':      {accelerator: 'wasm'},
  'webgpu':    {accelerator: 'webgpu'},
  'webnn-gpu': {accelerator: 'webnn', webNNOptions: {devicePreference: 'gpu'}},
  'webnn-npu': {accelerator: 'webnn', webNNOptions: {devicePreference: 'npu'}},
};

const $ = (id) => document.getElementById(id);
const modelSel = $('model'), resultsEl = $('results'), logEl = $('log');

// ---------------------------------------------------------------- URL params

const params = new URLSearchParams(location.search);
if (params.get('litertjs')) $('version').value = params.get('litertjs');

for (const m of MODELS) {
  const o = document.createElement('option');
  o.value = m.id;
  o.textContent = m.label;
  modelSel.append(o);
}
if (params.get('model')) modelSel.value = params.get('model');

const urlBackends = params.get('backend')?.split(',').map((s) => s.trim());
if (urlBackends) {
  for (const cb of document.querySelectorAll('.bk')) {
    cb.checked = urlBackends.includes(cb.value);
  }
}

// ---------------------------------------------------------------- environment

(async function reportEnv() {
  const lines = [
    `crossOriginIsolated : ${self.crossOriginIsolated}`,
    `SharedArrayBuffer   : ${typeof SharedArrayBuffer !== 'undefined'}`,
    `navigator.ml (WebNN): ${'ml' in navigator}`,
    `navigator.gpu       : ${'gpu' in navigator}`,
    `hardwareConcurrency : ${navigator.hardwareConcurrency}`,
  ];
  try {
    // Channel is part of the measurement — never compare numbers across
    // channels or LiteRT versions. See CLAUDE.md, three measurement axes.
    const hv = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList']);
    const list = hv?.fullVersionList?.map((b) => `${b.brand} ${b.version}`).join(', ');
    lines.push(`browser             : ${list ?? navigator.userAgent}`);
  } catch {
    lines.push(`browser             : ${navigator.userAgent}`);
  }
  if ('gpu' in navigator) {
    try {
      const a = await navigator.gpu.requestAdapter();
      const i = a?.info ?? a?.adapterInfo;
      lines.push(`gpu adapter         : ${i ? [i.vendor, i.architecture, i.description].filter(Boolean).join(' / ') : 'unknown'}`);
    } catch (e) {
      lines.push(`gpu adapter         : error — ${e.message}`);
    }
  }
  $('env').textContent = lines.join('\n');
})();

// ---------------------------------------------------------------- console capture

/**
 * LiteRT reports partial delegation ONLY via console.warn. Intercept around the
 * compile so it reaches the UI instead of vanishing into devtools.
 */
async function captureConsole(fn) {
  const captured = [];
  const original = {warn: console.warn, error: console.error};
  for (const level of ['warn', 'error']) {
    console[level] = (...args) => {
      // LiteRT uses %c directives for its coloured banners; strip them so the
      // captured text stays readable.
      const text = args.filter((a) => typeof a === 'string').join(' ')
          .replace(/%c/g, '').replace(/\s{2,}/g, ' ').trim();
      if (text) captured.push(`[${level}] ${text}`);
      original[level].apply(console, args);
    };
  }
  try {
    return {value: await fn(), captured};
  } catch (e) {
    e.captured = captured;
    throw e;
  } finally {
    Object.assign(console, original);
  }
}

function appendLog(backend, lines) {
  if (!lines?.length) return;
  if (logEl.textContent === '(nothing yet)') logEl.textContent = '';
  logEl.textContent += `--- ${backend} ---\n${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- runtime load

let litert = null;
let loadedVersion = null;

async function ensureLiteRt(version) {
  if (!VERSION_RE.test(version)) {
    throw new Error(`Refusing to load version "${version}" — must be strict semver.`);
  }
  if (litert && loadedVersion === version) return litert;

  // Mode and version are module-global. Switching either needs an unload —
  // which is precisely why M1 uses one worker per backend instead.
  if (litert && typeof litert.unloadLiteRt === 'function') {
    try { litert.unloadLiteRt(); } catch { /* best effort */ }
  }

  const moduleUrl = `https://esm.sh/@litertjs/core@${version}`;
  const wasmRoot = `https://cdn.jsdelivr.net/npm/@litertjs/core@${version}/wasm`;

  const mod = await import(/* @vite-ignore */ moduleUrl);
  if (typeof mod.loadLiteRt !== 'function') {
    throw new Error(`@litertjs/core@${version} has no loadLiteRt export.`);
  }

  // loadLiteRt(wasmRoot) does NOT redirect Emscripten's own .wasm fetches.
  // locateFile is what actually points the runtime at the CDN.
  globalThis.Module = {locateFile: (path) => `${wasmRoot}/${path}`};
  try {
    await mod.loadLiteRt(wasmRoot, {jspi: true});
  } catch (e) {
    if (!/already load/i.test(e?.message ?? '')) throw e;
  } finally {
    delete globalThis.Module;
  }

  litert = mod;
  loadedVersion = version;
  return mod;
}

// ---------------------------------------------------------------- metrics

/** Ported from web-ai-run's computeMetrics. Warmup runs are excluded. */
function computeMetrics(samples, loadAndCompileMs, firstInferenceMs) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((s, n) => s + n, 0) / samples.length;
  return {
    load_and_compile_ms: loadAndCompileMs,
    first_inference_ms: firstInferenceMs,
    time_to_first_ms: loadAndCompileMs + firstInferenceMs,
    average_ms: avg,
    median_ms: sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    best_ms: sorted[0],
    p90_ms: sorted[Math.ceil(sorted.length * 0.9) - 1],
    throughput_fps: 1000 / avg,
    inference_times: samples,
  };
}

const DTYPE_CTOR = {
  float32: Float32Array, float16: Uint16Array, int32: Int32Array,
  uint32: Uint32Array, int8: Int8Array, uint8: Uint8Array, bool: Uint8Array,
};

/** Zero-filled inputs of whatever shape the model declares. Accuracy is not
 *  what this harness measures — delegation and latency are. */
function makeInputs(Tensor, details) {
  const inputs = {};
  for (const d of details) {
    const shape = Array.from(d.shape);
    const count = shape.reduce((a, b) => a * b, 1);
    const Ctor = DTYPE_CTOR[d.dtype] ?? Float32Array;
    inputs[d.name] = new Tensor(new Ctor(count), shape);
  }
  return inputs;
}

// ---------------------------------------------------------------- one backend

async function measureBackend(mod, backend, modelBytes, iters, warmupRuns) {
  let compiled = null;
  try {
    const t0 = performance.now();
    const {value, captured} = await captureConsole(async () => {
      if (backend === 'webgpu') {
        const adapter = await navigator.gpu.requestAdapter();
        mod.setWebGpuDevice(await adapter.requestDevice());
      }
      return mod.loadAndCompile(modelBytes, COMPILE_OPTS[backend]);
    });
    const loadAndCompileMs = performance.now() - t0;
    compiled = value;
    appendLog(backend, captured);

    const fullyAccelerated = compiled.isFullyAccelerated;
    // Under our Chrome target LiteRT never takes the total-fallback branch, so
    // this always echoes the request. Recorded to demonstrate that, not relied on.
    const effective = compiled.options?.accelerator ?? '(unknown)';

    const details = compiled.getInputDetails();
    const inputs = makeInputs(mod.Tensor, details);

    let firstInferenceMs = 0;
    const samples = [];
    for (let i = 0; i < warmupRuns + iters; i++) {
      const s = performance.now();
      const out = await compiled.run(inputs);
      const elapsed = performance.now() - s;
      if (i === 0) firstInferenceMs = elapsed;
      if (i >= warmupRuns) samples.push(elapsed);
      for (const t of Object.values(out ?? {})) t?.delete?.();
    }
    for (const t of Object.values(inputs)) t?.delete?.();

    return {
      backend, ok: true, fullyAccelerated, effective,
      inputs: details.map((d) => `${d.name}[${Array.from(d.shape).join(',')}]`).join(' '),
      metrics: computeMetrics(samples, loadAndCompileMs, firstInferenceMs),
    };
  } catch (e) {
    appendLog(backend, e.captured ?? [`[error] ${e.message}`]);
    return {backend, ok: false, error: e.message};
  } finally {
    compiled?.delete?.();
  }
}

// ---------------------------------------------------------------- render

const ms = (n) => n.toFixed(1);

function renderRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.backend = r.backend;

  if (!r.ok) {
    tr.innerHTML =
        `<td><span class="chip">${r.backend}</span></td>` +
        `<td class="deleg-failed">did not run</td>` +
        `<td colspan="5" class="suppressed"></td>`;
    tr.querySelector('.suppressed').textContent = r.error;
    resultsEl.append(tr);
    return;
  }

  const m = r.metrics;
  // Full delegation is the UNMARKED state; partial is what gets attention.
  // Latency is only presented as a real number when delegation is full.
  const deleg = r.fullyAccelerated
      ? '<span class="deleg-full">fully delegated</span>'
      : '<span class="deleg-partial">partially delegated — some ops on CPU</span>';
  const klass = r.fullyAccelerated ? 'num' : 'num suppressed';
  const cell = (v) => `<td class="${klass}">${ms(v)}</td>`;

  tr.innerHTML =
      `<td><span class="chip">${r.backend}</span></td>` +
      `<td>${deleg}</td>` +
      cell(m.load_and_compile_ms) +
      cell(m.first_inference_ms) +
      cell(m.median_ms) +
      cell(m.p90_ms) +
      `<td class="${klass}">${m.throughput_fps.toFixed(1)}</td>`;
  resultsEl.append(tr);

  // Full record to devtools — this is the data worth keeping from M0.
  console.log(r.backend, {
    fullyAccelerated: r.fullyAccelerated,
    effectiveAccelerator: r.effective,
    inputs: r.inputs,
    ...m,
  });
}

// ---------------------------------------------------------------- run

$('run').addEventListener('click', async () => {
  const btn = $('run'), status = $('status');
  const version = $('version').value.trim();
  const iters = Number($('iters').value);
  const warmupRuns = Number($('warmup').value);
  const backends = [...document.querySelectorAll('.bk:checked')].map((c) => c.value);
  const model = MODELS.find((m) => m.id === modelSel.value);

  resultsEl.innerHTML = '';
  logEl.textContent = '(nothing yet)';
  btn.disabled = true;

  try {
    status.textContent = `loading @litertjs/core@${version}…`;
    const mod = await ensureLiteRt(version);

    status.textContent = 'fetching model…';
    const res = await fetch(model.url);
    if (!res.ok) throw new Error(`model fetch ${res.status} — ${model.url}`);
    const modelBytes = new Uint8Array(await res.arrayBuffer());

    // Serial by construction: concurrent backends contend for memory bandwidth
    // and thermal headroom and corrupt each other's timings.
    for (const backend of backends) {
      status.textContent = `measuring ${backend}…`;
      renderRow(await measureBackend(mod, backend, modelBytes, iters, warmupRuns));
    }
    status.textContent = `done — ${model.label} on @litertjs/core@${version}`;
  } catch (e) {
    status.textContent = `failed: ${e.message}`;
    appendLog('harness', [`[error] ${e.stack ?? e.message}`]);
  } finally {
    btn.disabled = false;
  }
});
