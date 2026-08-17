import {describe, expect, it} from 'vitest';

import {typedArrayCtorFor} from './measure';

describe('typedArrayCtorFor', () => {
  it('maps float32 to Float32Array', () => {
    expect(typedArrayCtorFor({dtype: 'float32', name: 'x'})).toBe(Float32Array);
  });

  it('maps int32 to Int32Array', () => {
    expect(typedArrayCtorFor({dtype: 'int32', name: 'x'})).toBe(Int32Array);
  });

  it('maps uint8 to Uint8Array', () => {
    expect(typedArrayCtorFor({dtype: 'uint8', name: 'x'})).toBe(Uint8Array);
  });

  it('throws, naming the input, for an unhandled dtype rather than defaulting silently', () => {
    // LiteRT's DType is exactly float32|int32|uint8 today. If a future
    // version adds a dtype this map doesn't know about, defaulting to
    // Float32Array would allocate the wrong byte length and fail far from
    // the cause — this guard is what prevents that.
    // @ts-expect-error — deliberately passing a dtype outside the known union
    expect(() => typedArrayCtorFor({dtype: 'bfloat16', name: 'weird_input'}))
        .toThrow(/Unhandled input dtype "bfloat16" on "weird_input"/);
  });
});
