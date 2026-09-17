import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';
import {getLastCrop} from './crop-cache';

/**
 * Draws the upscaled tile directly — this is a real image output, not a
 * segmentation mask, so no colormap or argmax. Denormalizes [0, 1] back to
 * [0, 255] — the inverse of preprocess.ts's normalization, ported from the
 * reference's `(outputData[i] - min) / scaleFactor` with `min=0,
 * scaleFactor=1/255`.
 *
 * Presented as a SPLIT COMPARISON: the same crop bicubic-upscaled on the left,
 * the model's output on the right, meeting at a divider down the middle.
 * Every other demo's output is self-evident — a depth map, boxes, a mask — but
 * an upscaled image means nothing without the alternative beside it, and "is
 * this better than free interpolation?" is the only question this page is
 * actually asking. A wipe rather than two side-by-side panes because it keeps
 * both halves at full output resolution: two panes would halve each one's
 * pixels, which on a super-resolution demo defeats the point.
 */
export function renderRealEsrgan(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData): void {
  const output = outputDetails[0];
  if (!output) throw new Error('real-esrgan: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`real-esrgan: no output data for "${output.name}"`);

  // Reference output shape is [1, H, W, 3] (NHWC) — same layout as the
  // input, just larger (the model's own upscale factor).
  const shape = Array.from(output.shape);
  const [, outHeight, outWidth, channels] = shape;
  if (outHeight === undefined || outWidth === undefined || channels === undefined) {
    throw new Error(`real-esrgan: unexpected output rank ${shape.length}, shape [${shape}]`);
  }
  if (channels !== 3) {
    throw new Error(`real-esrgan: expected 3 output channels, model declares ${channels}`);
  }

  const tileCanvas = new OffscreenCanvas(outWidth, outHeight);
  const tileCtx = tileCanvas.getContext('2d');
  if (!tileCtx) throw new Error('OffscreenCanvas 2D context unavailable for rendering');
  const imageData = tileCtx.createImageData(outWidth, outHeight);

  for (let p = 0; p < outWidth * outHeight; p++) {
    const src = p * 3;
    const dst = p * 4;
    imageData.data[dst] = clamp255((values[src] ?? 0) * 255);
    imageData.data[dst + 1] = clamp255((values[src + 1] ?? 0) * 255);
    imageData.data[dst + 2] = clamp255((values[src + 2] ?? 0) * 255);
    imageData.data[dst + 3] = 255;
  }
  tileCtx.putImageData(imageData, 0, 0);

  const {width, height} = ctx.canvas;
  const crop = getLastCrop();

  // No crop cached (preprocess never ran) — show the model output alone rather
  // than a half-empty comparison.
  if (!crop) {
    ctx.drawImage(tileCanvas, 0, 0, width, height);
    return;
  }

  const mid = Math.round(width / 2);

  // Left: the same crop scaled up by the browser's own interpolation — the
  // "for free, no model" baseline this page is measured against.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, mid, height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop, 0, 0, width, height);
  ctx.restore();

  // Right: the model's output, same scene coordinates, so the seam is a
  // direct like-for-like comparison.
  ctx.save();
  ctx.beginPath();
  ctx.rect(mid, 0, width - mid, height);
  ctx.clip();
  ctx.drawImage(tileCanvas, 0, 0, width, height);
  ctx.restore();

  drawDivider(ctx, mid, height);
  drawCaption(ctx, 'Bicubic', 8, height - 8, 'left');
  drawCaption(ctx, 'Real-ESRGAN', width - 8, height - 8, 'right');
}

function drawDivider(ctx: OffscreenCanvasRenderingContext2D, x: number, height: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(x - 1, 0, 2, height);
}

/** Captions are drawn ON the canvas, not added to the page: demos supply a
 *  render() into a stage the shell owns and cannot add their own DOM or CSS
 *  (CLAUDE.md, design system). Same approach as object-detection's box
 *  labels. Shadowed rather than boxed so it stays legible over any image. */
function drawCaption(
    ctx: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number,
    align: 'left' | 'right'): void {
  ctx.save();
  ctx.font = '600 13px sans-serif';
  ctx.textAlign = align;
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
