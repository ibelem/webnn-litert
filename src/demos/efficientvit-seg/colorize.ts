/**
 * Argmax over the channel axis per pixel, colorized with a palette — shared
 * between efficientvit-seg's opaque render and efficientvit-live's blended
 * render. Ported from the reference's `colorsTensor.gather(segmentationClasses)`.
 */
export function colorizeSegmentationMask(
    outWidth: number, outHeight: number, numClasses: number,
    values: Float32Array | Int32Array | Uint8Array | readonly number[],
    palette: ReadonlyArray<readonly [number, number, number]>): OffscreenCanvas {
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
  return maskCanvas;
}
