import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';

/**
 * Resizes the source image to the model's declared input shape and converts
 * it to normalized CHW float32 — ported from the upstream reference demo's
 * exact preprocessing (`reference/litert/litert/js/demos/depth_anything/src/depth_estimator.ts`):
 * RGB channels only (alpha dropped), each scaled to [0, 1] by dividing by
 * 255, no mean/std normalization, laid out as [1, 3, H, W].
 *
 * Runs inside the worker: `OffscreenCanvas` and `getImageData` are both
 * available in worker scope, which is what makes it possible to resize AFTER
 * compiling the model reveals the real input dimensions — see
 * runner/litert.worker.ts.
 */
export function preprocessDepthAnything(
    mod: LiteRt, details: readonly TensorDetails[],
    image: ImageBitmap): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('depth-anything: model declares no inputs');

  // Reference shape is [1, channels, H, W] (NCHW).
  const shape = Array.from(input.shape);
  const [, channels, height, width] = shape;
  if (channels === undefined || height === undefined || width === undefined) {
    throw new Error(`depth-anything: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`depth-anything: expected 3 input channels, model declares ${channels}`);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for preprocessing');
  ctx.drawImage(image, 0, 0, width, height);
  const {data: rgba} = ctx.getImageData(0, 0, width, height);

  const chw = new Float32Array(width * height * channels);
  const plane = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const p = y * width + x;
      chw[p] = (r ?? 0) / 255;
      chw[plane + p] = (g ?? 0) / 255;
      chw[2 * plane + p] = (b ?? 0) / 255;
    }
  }

  return {[input.name]: new mod.Tensor(chw, [1, channels, height, width])};
}
