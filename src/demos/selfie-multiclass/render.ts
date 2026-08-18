import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/**
 * Argmax over the 6 category channels per pixel, colorized and alpha-blended
 * — ported verbatim from the upstream reference
 * (`reference/litert/litert/js/demos/selfie_multiclass/src/index.ts`,
 * `categoryColors` / `drawSegmentation`). Category meanings are the
 * reference's own comments, not verified against the model card — treat as
 * approximate labeling, not ground truth.
 */
const CATEGORY_COLORS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 0],           // 0: Background (transparent)
  [255, 99, 71, 150],     // 1: Hair
  [46, 139, 87, 150],     // 2: Body skin
  [65, 105, 225, 150],    // 3: Face skin
  [255, 215, 0, 150],     // 4: Clothes
  [218, 112, 214, 150],   // 5: Accessories
];

export function renderSelfieMulticlass(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData): void {
  const output = outputDetails[0];
  if (!output) throw new Error('selfie-multiclass: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`selfie-multiclass: no output data for "${output.name}"`);

  // Reference output shape is [1, H, W, numClasses] (NHWC).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth, numClasses] = shape;
  if (outHeight === undefined || outWidth === undefined || numClasses === undefined) {
    throw new Error(`selfie-multiclass: unexpected output rank ${shape.length}, shape [${shape}]`);
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
    const color = CATEGORY_COLORS[maxClass] ?? [0, 255, 255, 150]; // fallback: cyan
    const n = i * 4;
    imageData.data[n] = color[0];
    imageData.data[n + 1] = color[1];
    imageData.data[n + 2] = color[2];
    imageData.data[n + 3] = color[3];
  }
  maskCtx.putImageData(imageData, 0, 0);

  // Matches the reference exactly: it draws the colored mask alone via
  // putImageData onto its own canvas, never compositing over the original
  // webcam frame. Same here — a solid backdrop, then the mask.
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(maskCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
}
