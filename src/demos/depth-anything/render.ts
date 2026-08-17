import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/**
 * Min-max normalizes the depth map and colorizes it, then draws to the
 * display canvas — ported from the upstream reference's spectral colormap
 * (`reference/litert/litert/js/demos/depth_anything/src/depth_estimator.ts`,
 * `getColor`/`getSpectralColor`/`hslToRgb`), scaled to fill whatever size the
 * display canvas actually is rather than a fixed size.
 */
export function renderDepthAnything(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData): void {
  const output = outputDetails[0];
  if (!output) throw new Error('depth-anything: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`depth-anything: no output data for "${output.name}"`);

  // Reference output shape is [1, H, W] (single channel).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth] = shape;
  if (outHeight === undefined || outWidth === undefined) {
    throw new Error(`depth-anything: unexpected output rank ${shape.length}, shape [${shape}]`);
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1; // guard a flat (all-equal) output

  const depthCanvas = new OffscreenCanvas(outWidth, outHeight);
  const depthCtx = depthCanvas.getContext('2d');
  if (!depthCtx) throw new Error('OffscreenCanvas 2D context unavailable for rendering');
  const imageData = depthCtx.createImageData(outWidth, outHeight);

  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? min;
    const normalized = (v - min) / range;
    const [r, g, b] = spectralColor(normalized);
    const j = i * 4;
    imageData.data[j] = r;
    imageData.data[j + 1] = g;
    imageData.data[j + 2] = b;
    imageData.data[j + 3] = 255;
  }
  depthCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(depthCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function spectralColor(value: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, value));
  const hue = 0.7 * (1 - v) ** 1.5; // blue/violet (0.7) -> red (0.0)
  return hslToRgb(hue, 0.7, 0.5);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}
