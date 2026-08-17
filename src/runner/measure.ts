import type {CompiledModel, TensorDetails} from '@litertjs/core';

import {ensureLiteRt, errorMessage, type LiteRt, type LoadMode} from './loader';
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

function makeZeroInputs(mod: LiteRt, details: readonly TensorDetails[]) {
  const inputs: Record<string, InstanceType<typeof mod.Tensor>> = {};
  for (const d of details) {
    const Ctor = DTYPE_CTOR[d.dtype];
    // Fail loudly. Defaulting to Float32Array would allocate the wrong byte
    // length for a narrower dtype and surface far from the cause.
    if (!Ctor) throw new Error(`Unhandled input dtype "${d.dtype}" on "${d.name}"`);
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
 * Runs one backend end to end and returns its full record.
 *
 * Never throws: a backend that cannot run is a result (`delegation: 'failed'`),
 * not an exception, because the compare view must still show the other three.
 */
export async function measureBackend(
    backend: Backend,
    litertVersion: string,
    modelBytes: Uint8Array,
    iterations: number,
    warmupRuns: number,
): Promise<RunRecord> {
  let compiled: CompiledModel | null = null;

  try {
    const mod = await ensureLiteRt(litertVersion, loadModeFor(backend));

    const started = performance.now();
    const {value, warnings} = await withConsoleCapture(async () => {
      if (backend === 'webgpu') {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('no WebGPU adapter available');
        mod.setWebGpuDevice(await adapter.requestDevice());
      }
      return mod.loadAndCompile(modelBytes, compileOptionsFor(backend));
    });
    const loadAndCompileMs = performance.now() - started;

    compiled = value;
    const delegation: Delegation = compiled.isFullyAccelerated ? 'full' : 'partial';
    const details = compiled.getInputDetails();
    const inputs = makeZeroInputs(mod, details);

    let firstInferenceMs = 0;
    const samples: number[] = [];

    for (let i = 0; i < warmupRuns + iterations; i++) {
      const t0 = performance.now();
      const out = await compiled.run(inputs);

      // MANDATORY. WebGPU submits asynchronously: run() resolves once commands
      // are enqueued, not once they have executed. Without this readback the
      // timer measures submission and reports impossible numbers — measured
      // 0.2ms / 3055fps for MobileNetV2 before it was added. Upstream's own
      // demo also stops its timer only after awaiting .data().
      //
      // Applied to every backend, not just WebGPU, because uniformity is what
      // makes the figures comparable. Metric is "time to usable output".
      const outTensors = Array.isArray(out) ? out : Object.values(out);
      await Promise.all(outTensors.map((t) => t.data()));

      const elapsed = performance.now() - t0;
      if (i === 0) firstInferenceMs = elapsed;
      if (i >= warmupRuns) samples.push(elapsed);

      for (const t of outTensors) t.delete();
    }

    for (const t of Object.values(inputs)) t.delete();

    return {
      backend,
      delegation,
      effectiveAccelerator: compiled.options.accelerator ?? '(unknown)',
      warnings,
      inputs: describeInputs(details),
      metrics: computeMetrics(samples, loadAndCompileMs, firstInferenceMs),
    };
  } catch (e) {
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
