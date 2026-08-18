import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/**
 * Draws the upscaled tile directly — this is a real image output, not a
 * segmentation mask, so no colormap or argmax. Denormalizes [0, 1] back to
 * [0, 255] — the inverse of preprocess.ts's normalization, ported from the
 * reference's `(outputData[i] - min) / scaleFactor` with `min=0,
 * scaleFactor=1/255`.
 */
export function renderRealEsrgan(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData): void {
  const output = outputDetails[0];
  if (!output) throw new Error('real-esrgan: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`real-esrgan: no output data for "${output.name}"`);

  // Reference output shape is [1, H, W, 3] (NHWC) — same layout as the
  // input, just larger (the model's own upscale factor).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth, channels] = shape;
  if (outHeight === undefined || outWidth === undefined || channels === undefined) {
    throw new Error(`real-esrgan: unexpected output rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`real-esrgan: expected 3 output channels, model declares ${channels}`);
  }

  const tileCanvas = new OffscreenCanvas(outWidth, outHeight);
  const tileCtx = tileCanvas.getContext('2d');
  if (!tileCtx) throw new Error('OffscreenCanvas 2D context unavailable for rendering');
  const imageData = tileCtx.createImageData(outWidth, outHeight);

  for (let p = 0; p < outWidth * outHeight; p++) {
    const src = p * 3;
    const dst = p * 4;
    imageData.data[dst] = clamp255((values[src] ?? 0) * 255);
    imageData.data[dst + 1] = clamp255((values[src + 1] ?? 0) * 255);
    imageData.data[dst + 2] = clamp255((values[src + 2] ?? 0) * 255);
    imageData.data[dst + 3] = 255;
  }
  tileCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(tileCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
