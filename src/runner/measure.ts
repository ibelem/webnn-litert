import type {CompiledModel, TensorDetails} from '@litertjs/core';

import {ensureLiteRt, errorMessage, withTimeout, type LiteRt, type LoadMode} from './loader';
import {computeMetrics} from './metrics';
import type {Backend, Delegation, RunRecord} from './types';

/** WebNN and WebGPU require JSPI; the CPU baseline wants threads. */
export function loadModeFor(backend: Backend): LoadMode {
  return backend === 'wasm' ? 'threaded' : 'jspi';
}

type CompileOptions = Parameters<LiteRt['loadAndCompile']>[1];

function compileOptionsFor(backend: Backend): CompileOptions {
  switch (backend) {
    case 'wasm':
      return {accelerator: 'wasm'};
    case 'webgpu':
      return {accelerator: 'webgpu'};
    case 'webnn-gpu':
      return {accelerator: 'webnn', webNNOptions: {devicePreference: 'gpu'}};
    case 'webnn-npu':
      return {accelerator: 'webnn', webNNOptions: {devicePreference: 'npu'}};
  }
}

/** LiteRT's DType is exactly these three (core/src/datatypes.ts DATATYPES). */
const DTYPE_CTOR = {
  float32: Float32Array,
  int32: Int32Array,
  uint8: Uint8Array,
} as const;

/**
 * Captures console.warn / console.error for the duration of `fn`.
 *
 * Not optional instrumentation: partial delegation is reported ONLY through
 * console.warn, so this is half the evidence the whole site rests on.
 */
async function withConsoleCapture<T>(fn: () => Promise<T>):
    Promise<{value: T; warnings: string[]}> {
  const warnings: string[] = [];
  const original = {warn: console.warn, error: console.error};

  for (const level of ['warn', 'error'] as const) {
    console[level] = (...args: unknown[]) => {
      // LiteRT uses %c directives for its coloured banners; strip them.
      const text = args.filter((a): a is string => typeof a === 'string')
                       .join(' ')
                       .replace(/%c/g, '')
                       .replace(/\s{2,}/g, ' ')
                       .trim();
      if (text) warnings.push(`[${level}] ${text}`);
      original[level](...args);
    };
  }

  try {
    return {value: await fn(), warnings};
  } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

/**
 * Extracted as its own pure function so the "unhandled dtype" guard is
 * testable without a real LiteRT module — see measure.test.ts.
 * Fail loudly: defaulting to Float32Array would allocate the wrong byte
 * length for a narrower dtype and surface far from the cause.
 */
export function typedArrayCtorFor(d: Pick<TensorDetails, 'dtype' | 'name'>) {
  const Ctor = DTYPE_CTOR[d.dtype];
  if (!Ctor) throw new Error(`Unhandled input dtype "${d.dtype}" on "${d.name}"`);
  return Ctor;
}

function makeZeroInputs(mod: LiteRt, details: readonly TensorDetails[]) {
  const inputs: Record<string, InstanceType<typeof mod.Tensor>> = {};
  for (const d of details) {
    const Ctor = typedArrayCtorFor(d);
    const shape = Array.from(d.shape);
    const count = shape.reduce((a, b) => a * b, 1);
    inputs[d.name] = new mod.Tensor(new Ctor(count), shape);
  }
  return inputs;
}

function describeInputs(details: readonly TensorDetails[]): string {
  return details.map((d) => `${d.name}:${d.dtype}[${Array.from(d.shape).join(',')}]`)
      .join(' ');
}

/**
 * Errors we did not cause: a compile that legitimately can't run on this
 * hardware/driver, a network failure, an aborted/timed-out run. These become
 * `delegation: 'failed'` so the compare view survives one backend dying.
 *
 * Everything else (TypeError, ReferenceError, RangeError — programmer errors:
 * a null dereference, a bad argument, an out-of-range index) is NOT caught
 * here. It propagates as a real exception, because reporting a bug in our own
 * code as "this backend did not run" asserts a hardware verdict we have not
 * earned — the exact failure mode this project exists to prevent, pointed
 * inward. See CLAUDE.md, "the one rule that matters".
 */
function isEnvironmentFailure(e: unknown): boolean {
  return !(e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError);
}

/** A named output tensor's data, read back once already for timing purposes
 *  (see the MANDATORY readback comment below) — reused here rather than
 *  read twice. */
export type OutputData = Record<string, Awaited<ReturnType<InstanceType<LiteRt['Tensor']>['data']>>>;

export interface MeasureOptions {
  /** Aborts the compile and, on the next check, the inference loop. A hung
   *  driver or a dead CDN must not leave the caller waiting forever. */
  signal?: AbortSignal;
  /** Wall-clock budget for load+compile. WebNN graph building measured at
   *  ~2000ms on real hardware; this should sit comfortably above that. */
  compileTimeoutMs?: number;
  /**
   * Builds the input tensors for every run. Defaults to zero-filled inputs of
   * the model's declared shape — correct for /debug, where delegation truth
   * and latency are the point and real pixels add nothing. Demos pass real
   * preprocessed data here instead of duplicating the compile/timing loop.
   */
  buildInputs?: (mod: LiteRt, details: readonly TensorDetails[]) =>
      Record<string, InstanceType<LiteRt['Tensor']>>;
  /**
   * Called once, with the LAST iteration's output data, before it is deleted.
   * Demos use this to capture pixels for rendering — the readback this needs
   * already happens every iteration for timing, so this adds no extra cost.
   */
  onFinalOutput?: (details: readonly TensorDetails[], data: OutputData) => void;
  /**
   * Incremental, timestamped progress lines (compile start, per-iteration
   * counters, final stats) — for the log-status panel's running transcript,
   * distinct from the two on-page metrics. Ported in spirit from
   * web-ai-run's sendStatus/log calls. Fired after each iteration's timing
   * is already captured, so logging itself never counts toward a sample.
   */
  onLog?: (message: string) => void;
}

const DEFAULT_COMPILE_TIMEOUT_MS = 30_000;

export interface CompileResult {
  compiled: CompiledModel;
  delegation: Delegation;
  warnings: string[];
  loadAndCompileMs: number;
}

/**
 * Compiles one backend and reports delegation truth — the part of
 * measureBackend that a continuous/live run (compile once, then loop
 * indefinitely instead of a fixed N iterations) needs too. Extracted so
 * that shape of run can share this instead of duplicating the WebGPU
 * device setup and console-warning capture, which is where partial
 * delegation is reported (see withConsoleCapture's doc comment).
 */
export async function compileForBackend(
    mod: LiteRt, backend: Backend, modelBytes: Uint8Array, signal?: AbortSignal,
    onLog?: (message: string) => void,
    compileTimeoutMs = DEFAULT_COMPILE_TIMEOUT_MS): Promise<CompileResult> {
  const compileController = new AbortController();
  const compileTimer = setTimeout(() => compileController.abort(), compileTimeoutMs);
  const combined = anySignal([signal, compileController.signal]);

  onLog?.(`Compiling model with ${backend} backend...`);
  const started = performance.now();
  let value: CompiledModel;
  let warnings: string[];
  try {
    ({value, warnings} = await withConsoleCapture(async () => withTimeout(
         (async () => {
           // loadLiteRt() already auto-creates a default WebGPU device (see
           // Environment.create() in load_litert.ts). Requesting another
           // adapter/device here on every re-run replaces the module's
           // default Environment without disposing the old one — the old
           // native LiteRtEnvironment is never deleted, and the resulting
           // churn corrupts WebGPU output on the second and later runs in
           // the same worker (compiles fine, produces all-zero tensors).
           // Only step in if the default device creation didn't happen.
           if (backend === 'webgpu' && !mod.getWebGpuDevice()) {
             const adapter = await navigator.gpu?.requestAdapter();
             if (!adapter) throw new Error('no WebGPU adapter available');
             mod.setWebGpuDevice(await adapter.requestDevice());
           }
           return mod.loadAndCompile(modelBytes, compileOptionsFor(backend));
         })(),
         combined, 'compile')));
  } finally {
    clearTimeout(compileTimer);
  }
  const loadAndCompileMs = performance.now() - started;
  onLog?.(`Load+Compile Time: ${loadAndCompileMs.toFixed(2)} ms`);

  const delegation: Delegation = value.isFullyAccelerated ? 'full' : 'partial';
  return {compiled: value, delegation, warnings, loadAndCompileMs};
}

/**
 * Runs one backend end to end and returns its full record.
 *
 * Never throws for environment failures: a backend that cannot run for
 * hardware/driver/network reasons is a result (`delegation: 'failed'`), not an
 * exception. DOES throw for programmer errors — see isEnvironmentFailure.
 */
export async function measureBackend(
    backend: Backend,
    litertVersion: string,
    modelBytes: Uint8Array,
    iterations: number,
    warmupRuns: number,
    options: MeasureOptions = {},
): Promise<RunRecord> {
  const {
    signal,
    compileTimeoutMs = DEFAULT_COMPILE_TIMEOUT_MS,
    buildInputs = makeZeroInputs,
    onFinalOutput,
    onLog,
  } = options;
  let compiled: CompiledModel | null = null;

  try {
    onLog?.(`Loading LiteRT.js v${litertVersion}...`);
    const mod = await ensureLiteRt(litertVersion, loadModeFor(backend), signal, onLog);

    const compileResult =
        await compileForBackend(mod, backend, modelBytes, signal, onLog, compileTimeoutMs);
    compiled = compileResult.compiled;
    const {delegation, warnings, loadAndCompileMs} = compileResult;
    const details = compiled.getInputDetails();
    const outputDetails = compiled.getOutputDetails();
    const inputs = buildInputs(mod, details);

    let firstInferenceMs = 0;
    const warmupTimes: number[] = [];
    const samples: number[] = [];
    // Throttle "Inferencing i/n" lines to ~10 total — logging every one of
    // 1000 iterations would flood the panel and add postMessage overhead.
    const progressStep = Math.max(1, Math.floor(iterations / 10));

    if (warmupRuns > 0) onLog?.(`Warming up (${warmupRuns} run${warmupRuns === 1 ? '' : 's'})...`);
    else onLog?.(`Inferencing 0/${iterations}...`);

    for (let i = 0; i < warmupRuns + iterations; i++) {
      signal?.throwIfAborted();

      const t0 = performance.now();
      const out = await compiled.run(inputs);

      // MANDATORY. WebGPU submits asynchronously: run() resolves once commands
      // are enqueued, not once they have executed. Without this readback the
      // timer measures submission and reports impossible numbers — measured
      // 0.2ms / 3055fps for MobileNetV2 before it was added. Upstream's own
      // demo also stops its timer only after awaiting .data().
      //
      // Applied to every backend, not just WebGPU, because uniformity is what
      // makes the figures comparable. Metric is "time to usable output", not
      // kernel time — and for a large-output demo (e.g. 4x upscaling) this
      // readback can dominate the number. DemoDefinition.maxCompareInput
      // (added when demos exist) caps input size in the side-by-side compare
      // view for exactly that reason; see DESIGN.md.
      const outTensors: Array<InstanceType<LiteRt['Tensor']>> =
          Array.isArray(out) ? out : Object.values(out);
      const outNames = Array.isArray(out) ?
          outputDetails.map((d) => d.name) : Object.keys(out);
      const outData = await Promise.all(outTensors.map((t) => t.data()));

      // Log lines fire after `elapsed` is captured, so they never count
      // toward a timed sample — same ordering web-ai-run's worker uses.
      const elapsed = performance.now() - t0;
      if (i === 0) firstInferenceMs = elapsed;
      if (i < warmupRuns) {
        warmupTimes.push(elapsed);
        if (i === warmupRuns - 1 && iterations > 0) onLog?.(`Inferencing 0/${iterations}...`);
      } else {
        samples.push(elapsed);
        const benchI = i - warmupRuns;
        if ((benchI + 1) % progressStep === 0 || benchI === iterations - 1) {
          onLog?.(`Inferencing ${benchI + 1}/${iterations}...`);
        }
      }

      const isLastIteration = i === warmupRuns + iterations - 1;
      if (isLastIteration && onFinalOutput) {
        const named: OutputData = {};
        outNames.forEach((name, idx) => {
          const d = outData[idx];
          if (d !== undefined) named[name] = d;
        });
        onFinalOutput(outputDetails, named);
      }

      for (const t of outTensors) t.delete();
    }

    for (const t of Object.values(inputs)) t.delete();

    const metrics = computeMetrics(samples, loadAndCompileMs, firstInferenceMs);
    if (warmupRuns > 0) {
      onLog?.(`Warmup times: [${warmupTimes.map((t) => t.toFixed(2)).join(', ')}] ms`);
    }
    onLog?.(`First Inference Time: ${firstInferenceMs.toFixed(2)} ms`);
    onLog?.(`Time to First Inference: ${metrics.time_to_first_ms.toFixed(2)} ms`);
    onLog?.(`Inference times (ms): [${samples.map((t) => t.toFixed(2)).join(', ')}]`);
    onLog?.(`Average: ${metrics.average_ms.toFixed(2)} ms`);
    onLog?.(`Median: ${metrics.median_ms.toFixed(2)} ms`);
    onLog?.(`Best: ${metrics.best_ms.toFixed(2)} ms`);
    onLog?.(`P90: ${metrics.p90_ms.toFixed(2)} ms`);
    const totalMs = samples.reduce((a, b) => a + b, 0);
    onLog?.(`Total (${iterations} runs): ${totalMs.toFixed(2)} ms`);
    onLog?.(`Throughput: ${metrics.throughput_fps.toFixed(2)} FPS`);
    onLog?.(`Test completed with ${backend} backend`);

    return {
      backend,
      delegation,
      effectiveAccelerator: compiled.options.accelerator ?? '(unknown)',
      warnings,
      inputs: describeInputs(details),
      metrics,
    };
  } catch (e) {
    if (!isEnvironmentFailure(e)) throw e; // programmer error — do not mislabel as hardware

    return {
      backend,
      delegation: 'failed',
      effectiveAccelerator: '(n/a)',
      warnings: [],
      inputs: '',
      metrics: null,
      error: errorMessage(e),
    };
  } finally {
    compiled?.delete();
  }
}

/** AbortSignal.any() ponyfill — Chrome M153 has it natively, but keep this
 *  dependency-free rather than assuming. Returns a signal that aborts when
 *  any input signal aborts. */
function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {once: true});
  }
  return controller.signal;
}
