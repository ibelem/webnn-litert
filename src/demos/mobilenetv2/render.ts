import type {TensorDetails} from '@litertjs/core';

import type {OutputData} from '../../runner/measure';

/** `extra` shape for this demo: the label file's lines, index-aligned to the
 *  model's 1000 output classes. Threaded through RunMessage.extra since the
 *  worker cannot fetch this itself — see worker-protocol.ts. */
export interface MobilenetLabels {
  labels: readonly string[];
}

/**
 * Top-5 classification result, rendered as text — a valid "visual output"
 * for a classification demo; this project's own design system treats large
 * clear text as content, not as a fallback. Raw output values are shown
 * unmodified, matching the upstream reference exactly (it displays
 * `top5.values` straight from the model with no softmax applied) — not
 * inventing a probability interpretation the model may not actually support.
 */
export function renderMobilenetv2(
    ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
    data: OutputData, extra?: unknown): void {
  const output = outputDetails[0];
  if (!output) throw new Error('mobilenetv2: model declares no outputs');

  const values = data[output.name];
  if (!values) throw new Error(`mobilenetv2: no output data for "${output.name}"`);

  const labels = isMobilenetLabels(extra) ? extra.labels : [];

  const indices = Array.from(values, (_, i) => i)
      .sort((a, b) => (values[b] ?? -Infinity) - (values[a] ?? -Infinity))
      .slice(0, 5);

  const {width, height} = ctx.canvas;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '16px sans-serif';
  ctx.textBaseline = 'top';

  const lineHeight = 28;
  const padding = 12;
  indices.forEach((classIndex, rank) => {
    const label = labels[classIndex] ?? `class ${classIndex}`;
    const score = values[classIndex] ?? 0;
    ctx.fillText(`${rank + 1}. ${label}  (${score.toFixed(2)})`, padding, padding + rank * lineHeight);
  });
}

function isMobilenetLabels(v: unknown): v is MobilenetLabels {
  return typeof v === 'object' && v !== null && Array.isArray((v as MobilenetLabels).labels);
}
