/// <reference lib="webworker" />

/**
 * Worker runtime shared by every demo's worker. Not itself a worker entry —
 * a module worker's script is fixed at construction
 * (`new Worker(new URL('./worker-entry.ts', import.meta.url))`), so each demo
 * gets its own tiny entry file that imports `runDemoWorker` from here and
 * passes its own `preprocess`/`render`. See demos/depth-anything/worker-entry.ts.
 *
 * Owns the display OffscreenCanvas and draws into it directly — no per-frame
 * transfer back to the main thread. See CLAUDE.md, "Where rendering happens".
 *
 * Workers have no `document`/`window`, but DO have `OffscreenCanvas` and
 * `createImageBitmap` — so a demo's `preprocess` can create its own in-memory
 * canvas to resize the transferred source image to whatever shape the
 * compiled model actually declares via `getInputDetails()`. That's why
 * resizing happens here rather than on the main thread: the target size
 * isn't known until after compile, which happens in this worker.
 */
import type {TensorDetails} from '@litertjs/core';

import {measureBackend, type OutputData} from './measure';
import type {LiteRt} from './loader';
import type {MainToWorkerMessage, WorkerToMainMessage} from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

/** What a demo supplies to run inside its worker. */
export interface DemoWorkerHandler {
  /**
   * Builds input tensors from the full-resolution source image. Mirrors
   * measureBackend's buildInputs hook. `details[n].shape` is the model's
   * actual declared input shape — resize the image to match it here, using
   * an in-worker `OffscreenCanvas`, rather than assuming a fixed size.
   */
  preprocess(
      mod: LiteRt, details: readonly TensorDetails[], image: ImageBitmap,
      extra?: unknown): Record<string, InstanceType<LiteRt['Tensor']>>;
  /** Draws the final iteration's output directly onto the OffscreenCanvas
   *  context this worker owns. `data` values are already-read TypedArrays —
   *  no further tensor access needed or safe (the tensors are deleted right
   *  after this call returns). `extra` is whatever RunMessage.extra carried
   *  (e.g. mobilenetv2's label list) — most demos ignore it. */
  render(
      ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
      data: OutputData, extra?: unknown): void;
}

/**
 * Call once, at module top level, from a demo's worker-entry.ts. Sets up
 * `self.onmessage` for the lifetime of this worker.
 */
export function runDemoWorker(handler: DemoWorkerHandler): void {
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let domMode = false;

  function post(message: WorkerToMainMessage): void {
    self.postMessage(message);
  }

  self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
    const msg = event.data;

    if (msg.type === 'init') {
      domMode = msg.domMode ?? false;
      if (!domMode) {
        const c = msg.canvas.getContext('2d');
        if (!c) throw new Error('OffscreenCanvas 2D context unavailable in worker');
        ctx = c;
      }
      return;
    }

    if (msg.type === 'run') {
      void handleRun(msg);
    }
  };

  async function handleRun(
      msg: Extract<MainToWorkerMessage, {type: 'run'}>): Promise<void> {
    if (!domMode && !ctx) {
      post({type: 'worker-error', requestId: msg.requestId, message: 'worker not initialized'});
      return;
    }
    const activeCtx = ctx;

    try {
      const record = await measureBackend(
          msg.backend,
          msg.litertVersion,
          new Uint8Array(msg.modelBytes),
          msg.iterations,
          msg.warmupRuns,
          {
            buildInputs: (mod, details) => {
              const inputs = handler.preprocess(mod, details, msg.image, msg.extra);
              msg.image.close(); // consumed once; free its backing memory promptly
              return inputs;
            },
            onFinalOutput: (outputDetails, data) => {
              if (domMode) {
                // In DOM mode, send output data back to main thread for rendering
                post({
                  type: 'render-data',
                  requestId: msg.requestId,
                  outputDetails: outputDetails.map(d => ({
                    name: d.name,
                    shape: Array.from(d.shape),
                    dtype: d.dtype,
                  })),
                  data,
                  extra: msg.extra,
                });
              } else {
                // Canvas mode: render directly to OffscreenCanvas
                handler.render(activeCtx!, outputDetails, data, msg.extra);
              }
            },
          });
      post({type: 'record', requestId: msg.requestId, record});
    } catch (e) {
      // measureBackend re-throws programmer errors on purpose (see measure.ts,
      // isEnvironmentFailure) — an uncaught throw here would otherwise just
      // kill the worker silently. Surface it as a distinct message type so
      // the main thread can tell "this is our bug" apart from a RunRecord
      // whose delegation is 'failed'.
      post({
        type: 'worker-error',
        requestId: msg.requestId,
        message: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  }
}
