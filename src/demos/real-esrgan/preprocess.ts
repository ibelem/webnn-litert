import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';

/**
 * Crops/resizes to the model's declared input shape and normalizes to
 * [0, 1] — ported from the upstream reference
 * (`reference/litert/litert/js/demos/real_esrgan/src/upscaler.ts`), NHWC
 * layout. The model's own normalizationRange is `[0, 1]`
 * (`image_upscaler.ts`'s `MODELS` map), which happens to be the same plain
 * `/255` formula as depth-anything — the two demos landed on the same
 * numbers independently, not because they share code.
 *
 * SCOPE NOTE: the reference tiles an arbitrary-size source image into
 * overlapping model-input-sized crops and stitches the upscaled tiles back
 * together (`upscaleImageWithTiling`). That doesn't fit this project's
 * measureBackend loop, which times N repeated runs of ONE fixed input — a
 * multi-tile pipeline needs its own per-tile inference calls inside a single
 * logical "run", a different shape of loop entirely. Rather than bypass the
 * proven measure/worker architecture for one demo this late in the build,
 * this demo upscales exactly ONE tile — a plain resize to the model's
 * declared input dimensions, not a tiled crop of a larger image. Real
 * multi-tile upscaling of an arbitrary photo is future work, not silently
 * simulated here.
 */
export function preprocessRealEsrgan(
    mod: LiteRt, details: readonly TensorDetails[],
    image: ImageBitmap): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('real-esrgan: model declares no inputs');

  // Reference shape is [1, H, W, channels] (NHWC).
  const shape = Array.from(input.shape);
  const [, height, width, channels] = shape;
  if (height === undefined || width === undefined || channels === undefined) {
    throw new Error(`real-esrgan: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`real-esrgan: expected 3 input channels, model declares ${channels}`);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for preprocessing');
  ctx.drawImage(image, 0, 0, width, height);
  const {data: rgba} = ctx.getImageData(0, 0, width, height);

  const nhwc = new Float32Array(width * height * channels);
  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    nhwc[p * 3] = (rgba[o] ?? 0) / 255;
    nhwc[p * 3 + 1] = (rgba[o + 1] ?? 0) / 255;
    nhwc[p * 3 + 2] = (rgba[o + 2] ?? 0) / 255;
  }

  return {[input.name]: new mod.Tensor(nhwc, [1, height, width, channels])};
}
