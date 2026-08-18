import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/** `extra` shape: the ADE20K palette, index-aligned to the model's 150
 *  output classes — ported verbatim from the reference's
 *  `ade20k_class_colors.json` (see public/data/), not re-derived. */
export interface Ade20kPalette {
  colors: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * Argmax over the channel axis per pixel, colorized with the ADE20K palette
 * — ported from the reference's `colorsTensor.gather(segmentationClasses)`.
 * Unlike selfie-multiclass's semi-transparent overlay, this is opaque RGB —
 * the reference draws it as a full replacement image via `tf.browser.draw`,
 * not a blend over the source frame.
 */
export function renderEfficientVit(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData, extra?: unknown): void {
  const output = outputDetails[0];
  if (!output) throw new Error('efficientvit-seg: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`efficientvit-seg: no output data for "${output.name}"`);

  const palette = isAde20kPalette(extra) ? extra.colors : [];

  // Reference output shape is [1, H, W, numClasses] (NHWC).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth, numClasses] = shape;
  if (outHeight === undefined || outWidth === undefined || numClasses === undefined) {
    throw new Error(`efficientvit-seg: unexpected output rank ${shape.length}, shape [${shape}]`);
  }

  const maskCanvas = new OffscreenCanvas(outWidth, outHeight);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('OffscreenCanvas 2D context unavailable for rendering');
  const imageData = maskCtx.createImageData(outWidth, outHeight);

  for (let i = 0; i < outWidth * outHeight; i++) {
    const base = i * numClasses;
    let maxProb = -Infinity;
    let maxClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const v = values[base + c] ?? -Infinity;
      if (v > maxProb) {
        maxProb = v;
        maxClass = c;
      }
    }
    const color = palette[maxClass] ?? [128, 128, 128]; // fallback: mid-grey
    const n = i * 4;
    imageData.data[n] = color[0];
    imageData.data[n + 1] = color[1];
    imageData.data[n + 2] = color[2];
    imageData.data[n + 3] = 255;
  }
  maskCtx.putImageData(imageData, 0, 0);

  ctx.drawImage(maskCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function isAde20kPalette(v: unknown): v is Ade20kPalette {
  return typeof v === 'object' && v !== null && Array.isArray((v as Ade20kPalette).colors);
}
