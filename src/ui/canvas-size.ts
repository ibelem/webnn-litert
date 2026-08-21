/**
 * Scales (width, height) down to fit within maxDimension on the longer
 * side, preserving aspect ratio — so an output canvas can match its source
 * image or webcam frame's shape instead of always being forced square.
 */
export function fitCanvasSize(
    width: number, height: number, maxDimension: number): {width: number; height: number} {
  if (!(width > 0) || !(height > 0)) return {width: maxDimension, height: maxDimension};
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
