import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';

/**
 * Resizes to the model's declared input shape and normalizes — ported from
 * the upstream reference (`reference/litert/litert/js/demos/selfie_multiclass/src/index.ts`):
 * `resized.div(127.5).sub(1.0)`, i.e. each channel mapped to [-1, 1]. This is
 * a DIFFERENT normalization from depth-anything's `/255` — do not assume
 * demos share preprocessing just because both are image models.
 *
 * Layout is NHWC ([1, H, W, 3]), not depth-anything's NCHW — which happens to
 * make this simpler than depth-anything's preprocessing: canvas ImageData is
 * already channel-last per pixel, so no channel-plane transpose is needed,
 * only dropping alpha and normalizing in place.
 */
export function preprocessSelfieMulticlass(
    mod: LiteRt, details: readonly TensorDetails[],
    image: ImageBitmap): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('selfie-multiclass: model declares no inputs');

  // Reference shape is [1, H, W, channels] (NHWC).
  const shape = Array.from(input.shape);
  const [, height, width, channels] = shape;
  if (height === undefined || width === undefined || channels === undefined) {
    throw new Error(`selfie-multiclass: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`selfie-multiclass: expected 3 input channels, model declares ${channels}`);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for preprocessing');
  ctx.drawImage(image, 0, 0, width, height);
  const {data: rgba} = ctx.getImageData(0, 0, width, height);

  const nhwc = new Float32Array(width * height * channels);
  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    nhwc[p * 3] = (rgba[o] ?? 0) / 127.5 - 1;
    nhwc[p * 3 + 1] = (rgba[o + 1] ?? 0) / 127.5 - 1;
    nhwc[p * 3 + 2] = (rgba[o + 2] ?? 0) / 127.5 - 1;
  }

  return {[input.name]: new mod.Tensor(nhwc, [1, height, width, channels])};
}
