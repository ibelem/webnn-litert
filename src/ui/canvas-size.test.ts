import {describe, expect, it} from 'vitest';

import {fitCanvasSize} from './canvas-size';

describe('fitCanvasSize', () => {
  it('preserves aspect ratio for a wide image', () => {
    expect(fitCanvasSize(1600, 800, 384)).toEqual({width: 384, height: 192});
  });

  it('preserves aspect ratio for a tall image', () => {
    expect(fitCanvasSize(480, 640, 384)).toEqual({width: 288, height: 384});
  });

  it('does not upscale an image smaller than maxDimension', () => {
    expect(fitCanvasSize(100, 50, 384)).toEqual({width: 100, height: 50});
  });

  it('leaves a square image square', () => {
    expect(fitCanvasSize(512, 512, 384)).toEqual({width: 384, height: 384});
  });

  it('falls back to a square of maxDimension when given invalid input', () => {
    expect(fitCanvasSize(0, 0, 384)).toEqual({width: 384, height: 384});
    expect(fitCanvasSize(-1, 100, 384)).toEqual({width: 384, height: 384});
  });
});
