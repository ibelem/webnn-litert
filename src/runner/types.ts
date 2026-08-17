/** The four backends the site exposes. `wasm` is an opt-in CPU baseline. */
export const BACKENDS = ['webnn-npu', 'webnn-gpu', 'webgpu', 'wasm'] as const;
export type Backend = (typeof BACKENDS)[number];

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
