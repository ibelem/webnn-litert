import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';

/**
 * Resizes to the model's declared input shape and normalizes with the
 * PyTorch MobileNetV2 ImageNet transforms — ported from the upstream
 * reference (`reference/litert/litert/js/demos/mobilenetv2/src/index.ts`,
 * which cites `MobileNet_V2_Weights.IMAGENET1K_V2.transforms`):
 * `(pixel/255 - mean[c]) / std[c]` per channel, NCHW layout. This is a THIRD
 * distinct normalization in this codebase (depth-anything: plain /255, no
 * mean/std; selfie-multiclass: /127.5 - 1, NHWC) — never assume two image
 * demos share preprocessing.
 */
const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

export function preprocessMobilenetv2(
    mod: LiteRt, details: readonly TensorDetails[],
    image: ImageBitmap): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('mobilenetv2: model declares no inputs');

  // Reference shape is [1, channels, H, W] (NCHW).
  const shape = Array.from(input.shape);
  const [, channels, height, width] = shape;
  if (channels === undefined || height === undefined || width === undefined) {
    throw new Error(`mobilenetv2: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`mobilenetv2: expected 3 input channels, model declares ${channels}`);
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
      const p = y * width + x;
      const r = (rgba[i] ?? 0) / 255;
      const g = (rgba[i + 1] ?? 0) / 255;
      const b = (rgba[i + 2] ?? 0) / 255;
      chw[p] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
      chw[plane + p] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
      chw[2 * plane + p] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
  }

  return {[input.name]: new mod.Tensor(chw, [1, channels, height, width])};
}
