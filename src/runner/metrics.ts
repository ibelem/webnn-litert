import type {Metrics} from './types';

/**
 * Ported from ibelem/web-ai-run's computeMetrics. Do not redesign.
 *
 * Warmup samples must already be excluded by the caller; the first run is
 * passed in separately as `firstInferenceMs`.
 */
export function computeMetrics(
    samples: readonly number[],
    loadAndCompileMs: number,
    firstInferenceMs: number,
): Metrics {
  if (samples.length === 0) {
    throw new Error('computeMetrics: no samples — iterations must be >= 1');
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const average = samples.reduce((sum, n) => sum + n, 0) / samples.length;

  const mid = sorted.length / 2;
  const median = sorted.length % 2
      ? at(sorted, (sorted.length - 1) / 2)
      : (at(sorted, mid - 1) + at(sorted, mid)) / 2;

  return {
    load_and_compile_ms: loadAndCompileMs,
    first_inference_ms: firstInferenceMs,
    time_to_first_ms: loadAndCompileMs + firstInferenceMs,
    average_ms: average,
    median_ms: median,
    best_ms: at(sorted, 0),
    p90_ms: at(sorted, Math.ceil(sorted.length * 0.9) - 1),
    throughput_fps: 1000 / average,
    inference_times: [...samples],
  };
}

/** noUncheckedIndexedAccess makes every index access `T | undefined`. */
function at(xs: readonly number[], i: number): number {
  const v = xs[i];
  if (v === undefined) throw new Error(`computeMetrics: index ${i} out of range`);
  return v;
}
