import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';
import {colorizeSegmentationMask} from '../efficientvit-seg/colorize';
import type {Ade20kPalette} from '../efficientvit-seg/render';

export interface LiveRenderExtra {
  colors: Ade20kPalette['colors'];
  /** The exact frame the model just saw, kept open until after this render
   *  call — the sharp backdrop the mask blends over. */
  frame: ImageBitmap;
}

/**
 * Unlike efficientvit-seg's opaque full-replacement mask, this blends the
 * colorized mask over the actual camera frame — the reference's own fix
 * for how blocky a 512x512 mask looks stretched alone to full camera
 * resolution ("blend the mask with the original razor-sharp camera image").
 */
export function renderEfficientVitLive(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData, extra: LiveRenderExtra): void {
  const output = outputDetails[0];
  if (!output) throw new Error('efficientvit-live: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`efficientvit-live: no output data for "${output.name}"`);

  // Reference output shape is [1, H, W, numClasses] (NHWC).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth, numClasses] = shape;
  if (outHeight === undefined || outWidth === undefined || numClasses === undefined) {
    throw new Error(`efficientvit-live: unexpected output rank ${shape.length}, shape [${shape}]`);
  }

  const maskCanvas = colorizeSegmentationMask(outWidth, outHeight, numClasses, values, extra.colors);

  ctx.drawImage(extra.frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 0.6;
  ctx.drawImage(maskCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;
}
