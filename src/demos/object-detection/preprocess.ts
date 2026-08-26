import type {TensorDetails} from '@litertjs/core';

import type {LiteRt} from '../../runner/loader';
import {setLastFrame} from './frame-cache';

/**
 * Preprocess image for YOLOv2.6 detection.
 * 
 * Based on the reference implementation in YoloDetect-main/src/utils/detect.js:
 * - Resize to model input dimensions
 * - Normalize by dividing by 255
 * - Transpose from NHWC to NCHW for LiteRT
 */
export function preprocessYolo26(
    mod: LiteRt,
    details: readonly TensorDetails[],
    image: ImageBitmap,
): Record<string, InstanceType<LiteRt['Tensor']>> {
  const input = details[0];
  if (!input) throw new Error('yolo26: model declares no inputs');

  // Cache the full-resolution frame for render() to draw as the boxes'
  // backdrop — `image` itself is closed right after this function returns.
  const frame = new OffscreenCanvas(image.width, image.height);
  const frameCtx = frame.getContext('2d');
  if (frameCtx) {
    frameCtx.drawImage(image, 0, 0);
    setLastFrame(frame);
  }

  // YOLO models typically have NCHW input shape [1, 3, H, W]
  const shape = Array.from(input.shape);
  const [, channels, height, width] = shape;
  if (channels === undefined || height === undefined || width === undefined) {
    throw new Error(`yolo26: unexpected input rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`yolo26: expected 3 input channels, model declares ${channels}`);
  }

  // Resize to model input dimensions
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable for preprocessing');

  // Draw resized image
  ctx.drawImage(image, 0, 0, width, height);
  const {data} = ctx.getImageData(0, 0, width, height);

  // Convert to NCHW format and normalize
  const chw = new Float32Array(width * height * channels);
  const plane = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const p = y * width + x;
      // Normalize by dividing by 255
      chw[p] = (data[i] ?? 0) / 255;           // R
      chw[plane + p] = (data[i + 1] ?? 0) / 255; // G
      chw[2 * plane + p] = (data[i + 2] ?? 0) / 255; // B
    }
  }

  return {
    [input.name]: new mod.Tensor(chw, [1, 3, height, width]),
  };
}