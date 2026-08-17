import {describe, expect, it} from 'vitest';

import {computeMetrics} from './metrics';

describe('computeMetrics', () => {
  it('throws on an empty sample array rather than computing NaN silently', () => {
    // Flagged in eng review, issue 3: this is the exact guard a blank
    // iterations field used to trip on before debug/main.ts clamped input.
    expect(() => computeMetrics([], 100, 5)).toThrow(/no samples/);
  });

  it('computes median for an odd-length sample array (middle element)', () => {
    const m = computeMetrics([30, 10, 20], 0, 0);
    expect(m.median_ms).toBe(20);
  });

  it('computes median for an even-length sample array (average of two middle)', () => {
    const m = computeMetrics([10, 20, 30, 40], 0, 0);
    expect(m.median_ms).toBe(25);
  });

  it('reports best as the minimum sample regardless of input order', () => {
    const m = computeMetrics([50, 5, 30], 0, 0);
    expect(m.best_ms).toBe(5);
  });

  it('computes p90 correctly at small N (the rounding-prone case)', () => {
    // index = ceil(N * 0.9) - 1, into the SORTED array.
    // N=1: ceil(0.9)-1 = 0            N=2: ceil(1.8)-1 = 1
    // N=3: ceil(2.7)-1 = 2
    expect(computeMetrics([7], 0, 0).p90_ms).toBe(7);
    expect(computeMetrics([7, 20], 0, 0).p90_ms).toBe(20);
    expect(computeMetrics([3, 1, 2], 0, 0).p90_ms).toBe(3);
  });

  it('handles a single-sample array: best, median and p90 all equal the sample', () => {
    const m = computeMetrics([42], 0, 0);
    expect(m.best_ms).toBe(42);
    expect(m.median_ms).toBe(42);
    expect(m.p90_ms).toBe(42);
    expect(m.average_ms).toBe(42);
  });

  it('derives throughput as 1000/average', () => {
    const m = computeMetrics([10, 10, 10, 10], 0, 0);
    expect(m.throughput_fps).toBeCloseTo(100, 5);
  });

  it('sums load_and_compile and first_inference into time_to_first', () => {
    const m = computeMetrics([1], 120, 8);
    expect(m.time_to_first_ms).toBe(128);
  });

  it('preserves the original sample order in inference_times (does not sort in place)', () => {
    const input = [30, 10, 20];
    const m = computeMetrics(input, 0, 0);
    expect(m.inference_times).toEqual([30, 10, 20]);
    expect(input).toEqual([30, 10, 20]); // caller's array must be untouched
  });
});
