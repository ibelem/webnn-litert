/**
 * Holds the last preprocessed source frame so render() can draw it as the
 * detection boxes' backdrop. preprocess() and render() run in the same
 * worker but don't share arguments — measure.ts's onFinalOutput only
 * receives tensor output data, not the original image — so this module
 * bridges the two. The source ImageBitmap itself is closed right after
 * preprocess() returns (see litert.worker.ts), so a copy is cached here
 * before that happens.
 */
let lastFrame: OffscreenCanvas | null = null;

export function setLastFrame(frame: OffscreenCanvas): void {
  lastFrame = frame;
}

export function getLastFrame(): OffscreenCanvas | null {
  return lastFrame;
}
