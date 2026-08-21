/** The five backends the site exposes. `wasm` is an opt-in CPU baseline;
 *  `webnn-cpu` is WebNN's own CPU path, distinct from wasm's plain-WASM one. */
export const BACKENDS = ['webnn-npu', 'webnn-gpu', 'webgpu', 'wasm', 'webnn-cpu'] as const;
export type Backend = (typeof BACKENDS)[number];

/**
 * Default single-backend selection for every demo page, for now. WebGPU
 * compiles in ~35ms versus WebNN's ~2000ms (measured on real hardware, see
 * docs/designs/litert-js-webnn-demo-site.md), is broadly available, and
 * doesn't depend on the still-unverified WebNN driver/NPU path. Once WebNN
 * delegation is confirmed reliable per demo, this should likely become
 * per-demo (WebNN NPU is the whole point for depth-anything specifically),
 * not a single site-wide constant — revisit then.
 */
export const DEFAULT_BACKEND: Backend = 'webgpu';

export function isBackend(v: string): v is Backend {
  return (BACKENDS as readonly string[]).includes(v);
}

/**
 * How much of the graph actually ran where it was asked to.
 *
 * Under our Chrome M153+/Canary target LiteRT never takes the total-fallback
 * branch, so `partial` is the EXPECTED outcome for WebNN — not an edge case.
 * `full` is therefore the quiet, unmarked state in the UI (see DESIGN.md).
 */
export type Delegation = 'full' | 'partial' | 'failed';

/** Everything computed. Only two of these are ever rendered on a demo page. */
export interface Metrics {
  load_and_compile_ms: number;
  first_inference_ms: number;
  time_to_first_ms: number;
  average_ms: number;
  median_ms: number;
  best_ms: number;
  p90_ms: number;
  throughput_fps: number;
  inference_times: number[];
}

/** One backend's complete result. Console gets all of it; the page gets two fields. */
export interface RunRecord {
  backend: Backend;
  delegation: Delegation;
  /**
   * `model.options.accelerator`. Recorded for completeness but NOT evidence:
   * on a JSPI browser it always echoes the request even when half the graph
   * ran on CPU. `delegation` is the signal.
   */
  effectiveAccelerator: string;
  /** LiteRT's console.warn output, the only place partial delegation is reported. */
  warnings: string[];
  inputs: string;
  metrics: Metrics | null;
  error?: string;
}

export interface RunConfig {
  litertVersion: string;
  modelUrl: string;
  backends: Backend[];
  iterations: number;
  warmupRuns: number;
}
