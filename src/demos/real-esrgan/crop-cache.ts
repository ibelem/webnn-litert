/**
 * Holds the native-resolution crop that preprocess() fed the model, so
 * render() can draw the naive-upscale half of the before/after comparison
 * from the exact same pixels. preprocess() and render() run in the same
 * worker but don't share arguments — litert.worker.ts's onFinalOutput only
 * receives tensor output data, not the source image, and it closes the
 * source ImageBitmap right after preprocess() returns. So the crop is cached
 * here before that happens.
 *
 * Same pattern as demos/object-detection/frame-cache.ts. Deliberately a
 * second small copy rather than a shared module: eight lines of module-global
 * state, and the two demos cache different things (a full frame vs. a crop).
 */
let lastCrop: OffscreenCanvas | null = null;

export function setLastCrop(crop: OffscreenCanvas): void {
  lastCrop = crop;
}

export function getLastCrop(): OffscreenCanvas | null {
  return lastCrop;
}
