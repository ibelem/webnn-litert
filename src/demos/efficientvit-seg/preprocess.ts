import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';

/**
 * Resizes to the model's declared input shape and normalizes — ported from
 * the upstream reference (`reference/litert/litert/js/demos/efficientvit_segmentation/src/index.ts`,
 * which cites the EfficientViT repo's own demo script):
 * `image.div(255).sub(mean).div(std)`, the SAME ImageNet mean/std as
 * mobilenetv2 — but NHWC layout here (no transpose to NCHW), unlike
 * mobilenetv2. Two demos can share a normalization formula and still differ
 * in tensor layout; check both, don't assume from one match.
 */
const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export function preprocessEfficientVit(
    mod: LiteRt, details: readonly TensorDetails[],
    image: ImageBitmap): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('efficientvit-seg: model declares no inputs');

  // Reference shape is [1, H, W, channels] (NHWC).
  const shape = Array.from(input.shape);
  const [, height, width, channels] = shape;
  if (height === undefined || width === undefined || channels === undefined) {
    throw new Error(`efficientvit-seg: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`efficientvit-seg: expected 3 input channels, model declares ${channels}`);
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for preprocessing');
  ctx.drawImage(image, 0, 0, width, height);
  const {data: rgba} = ctx.getImageData(0, 0, width, height);

  const nhwc = new Float32Array(width * height * channels);
  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    nhwc[p * 3] = ((rgba[o] ?? 0) / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    nhwc[p * 3 + 1] = ((rgba[o + 1] ?? 0) / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    nhwc[p * 3 + 2] = ((rgba[o + 2] ?? 0) / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  return {[input.name]: new mod.Tensor(nhwc, [1, height, width, channels])};
}
