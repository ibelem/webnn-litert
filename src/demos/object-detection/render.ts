import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';
import {getLastFrame} from './frame-cache';
import {postprocessYolo26} from './postprocess';

/**
 * `extra` shape for this demo: only set by the live worker (camera/video),
 * which passes the frame it just ran inference on directly, since that
 * worker's loop doesn't go through the shared preprocess/render wrapper
 * that frame-cache.ts otherwise relies on (see worker-entry-live.ts). The
 * discrete compare-grid path never sets this — it relies on frame-cache.
 */
export interface Yolo26LiveExtra {
  frame: ImageBitmap;
}

function isYolo26LiveExtra(v: unknown): v is Yolo26LiveExtra {
  return typeof v === 'object' && v !== null && 'frame' in v;
}

/**
 * Render YOLO detection results on the canvas.
 *
 * Draws:
 * - Semi-transparent filled rectangles for each detection
 * - Colored borders matching the class
 * - Label background with class name and confidence score
 */
export function renderYolo26(
    ctx: OffscreenCanvasRenderingContext2D,
    outputDetails: readonly TensorDetails[],
    data: OutputData,
    extra?: unknown,
): void {
  const detections = postprocessYolo26(outputDetails, data);

  const {width, height} = ctx.canvas;

  // Draw the source frame as the boxes' backdrop; fall back to a clear
  // canvas if it's somehow missing (e.g. preprocess never ran).
  const frame = isYolo26LiveExtra(extra) ? extra.frame : getLastFrame();
  if (frame) {
    ctx.drawImage(frame, 0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  // Draw each detection
  detections.forEach((detection) => {
    const [y1, x1, y2, x2] = detection.box;

    // Convert normalized coordinates to pixel coordinates
    const px1 = x1 * width;
    const py1 = y1 * height;
    const px2 = x2 * width;
    const py2 = y2 * height;

    const boxWidth = px2 - px1;
    const boxHeight = py2 - py1;

    // Get color for this class
    const color = getColor(detection.classId);
    const borderColor = hexToRgba(color, 1);
    const fillColor = hexToRgba(color, 0.2);

    // Draw filled rectangle (semi-transparent)
    ctx.fillStyle = fillColor;
    ctx.fillRect(px1, py1, boxWidth, boxHeight);

    // Draw border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(px1, py1, boxWidth, boxHeight);

    // Draw label background
    const label = `${detection.className} ${(detection.score * 100).toFixed(1)}%`;
    ctx.font = '12px sans-serif';
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = 14;

    ctx.fillStyle = borderColor;
    ctx.fillRect(px1, py1 - textHeight - 4, textWidth + 8, textHeight + 4);

    // Draw label text
    ctx.fillStyle = getTextColor(color);
    ctx.fillText(label, px1 + 4, py1 - 4);
  });
}

/**
 * Get color from Ultralytics palette based on class ID.
 * The palette has 20 colors, so we cycle through them.
 */
function getColor(classId: number): string {
  return ULTRALYTICS_PALETTE[classId % ULTRALYTICS_PALETTE.length] ?? '#FF3838';
}

/**
 * Convert hex color to RGBA string.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get text color (black or white) based on background color brightness.
 */
function getTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#000000' : '#ffffff';
}

/**
 * Ultralytics color palette for YOLO visualizations.
 * 20 colors that cycle through for different classes.
 */
const ULTRALYTICS_PALETTE = [
  '#FF3838', '#FF9D97', '#FF701F', '#FFB21D', '#CFD231', '#48F90A', '#92CC17',
  '#3DDB86', '#1A9334', '#00D4BB', '#2C99A8', '#00C2FF', '#344593', '#6473FF',
  '#0018EC', '#8438FF', '#520085', '#CB38FF', '#FF95C8', '#FF37C7',
];