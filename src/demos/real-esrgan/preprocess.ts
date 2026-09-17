import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';
import {setLastCrop} from './crop-cache';

/**
 * Takes a NATIVE-RESOLUTION centre crop of the source at the model's declared
 * input size and normalizes it to [0, 1] — ported from the upstream reference
 * (`reference/litert/litert/js/demos/real_esrgan/src/upscaler.ts`), NHWC
 * layout. The model's own normalizationRange is `[0, 1]`
 * (`image_upscaler.ts`'s `MODELS` map), which happens to be the same plain
 * `/255` formula as depth-anything — the two demos landed on the same numbers
 * independently, not because they share code.
 *
 * CROP, NOT RESIZE — this is the whole demo. An earlier version scaled the
 * entire source image down into the tile (`drawImage(image, 0, 0, w, h)`),
 * which for the 1230x667 sample and this model's 128x128 input threw away 96x
 * the detail and squashed a 2:1 photo into a square. The model was then asked
 * to restore detail the demo itself had just destroyed, and the 4x result
 * still came out blurrier than the original — a super-resolution demo that
 * made the picture worse. Cropping at 1:1 means the model is upscaling real
 * pixels it has never seen enlarged, which is the thing this page exists to
 * show.
 *
 * The visible consequence: this page shows a small centre patch of the photo,
 * not the whole photo. That is correct and deliberate.
 *
 * SCOPE NOTE: the reference tiles an arbitrary-size source into overlapping
 * model-input-sized crops and stitches the upscaled tiles back together
 * (`upscaleImageWithTiling`). That doesn't fit this project's measureBackend
 * loop, which times N repeated runs of ONE fixed input — a multi-tile pipeline
 * needs its own per-tile inference calls inside a single logical "run", a
 * different shape of loop entirely. This demo upscales exactly ONE tile.
 * Real multi-tile upscaling of a whole photo is future work, not silently
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

  // Largest centred region that is still 1:1 with the tile. When the source is
  // at least tile-sized in both axes — the normal case — cropW/cropH equal the
  // tile exactly, so this is a pure native-resolution crop with no rescaling
  // and no aspect distortion. A source smaller than the tile is scaled up
  // instead, which is the best available and still undistorted per axis.
  const cropW = Math.min(image.width, width);
  const cropH = Math.min(image.height, height);
  const sx = Math.max(0, (image.width - cropW) / 2);
  const sy = Math.max(0, (image.height - cropH) / 2);
  ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, width, height);

  const {data: rgba} = ctx.getImageData(0, 0, width, height);

  // Cache for render()'s naive-upscale comparison half — `image` itself is
  // closed right after this function returns (see litert.worker.ts).
  setLastCrop(canvas);

  const nhwc = new Float32Array(width * height * channels);
  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    nhwc[p * 3] = (rgba[o] ?? 0) / 255;
    nhwc[p * 3 + 1] = (rgba[o + 1] ?? 0) / 255;
    nhwc[p * 3 + 2] = (rgba[o + 2] ?? 0) / 255;
  }

  return {[input.name]: new mod.Tensor(nhwc, [1, height, width, channels])};
}
