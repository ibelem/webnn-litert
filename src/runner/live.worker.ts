/// <reference lib="webworker" />

/**
 * Shared runtime for the CONTINUOUS demos (camera / uploaded video). The live
 * counterpart to runner/litert.worker.ts's runDemoWorker: a demo's
 * worker-entry-live.ts calls runLiveWorker() with its preprocess/render pair
 * and nothing else.
 *
 * Does NOT use runDemoWorker, which is shaped around measureBackend's
 * discrete N-iteration run (warmup, fixed iteration count, one final record).
 * This compiles once, then loops indefinitely against a transferred
 * MediaStreamTrackProcessor .readable stream until told to stop. The frame
 * path never touches the main thread once started, per CLAUDE.md's "prefer
 * MediaStreamTrackProcessor inside the worker" note — though the processor
 * itself must be constructed on the main thread, because MediaStreamTrack is
 * not transferable (see live-stage.ts).
 *
 * Every demo importing this MUST stay a classic worker (imported via
 * `?worker`, never `{type: 'module'}`) — LiteRT's Emscripten loader calls
 * importScripts(), which module workers reject.
 */
import type {LiteRt} from './loader';
import {ensureLiteRt} from './loader';
import {compileForBackend, loadModeFor, type OutputData} from './measure';
import {computeMetrics} from './metrics';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './live-protocol';
import type {TensorDetails} from '@litertjs/core';

declare const self: DedicatedWorkerGlobalScope;

// ~6-7 updates/sec — legible on the metric row without jittering it every
// frame, same spirit as measure.ts throttling its "Inferencing i/n" lines.
const STATS_THROTTLE_MS = 150;
// A live loop has no "run 37 of 50" to report, so the log gets a periodic
// heartbeat instead of per-frame spam — slow enough to read, frequent enough
// to prove the loop is alive.
const LOG_THROTTLE_MS = 2000;
// Percentiles over a rolling window, not the whole session: 1000 samples is
// plenty for a stable median/p90 and bounds memory on a camera left open for
// hours. The reported frame count still counts every frame.
// ponytail: fixed window, revisit only if a session-wide p90 is ever needed.
const MAX_SAMPLES = 1000;

export interface LiveWorkerHandler {
  /**
   * Optional one-time setup run after compile and before the loop — e.g.
   * efficientvit-seg fetching its colour palette. Whatever it returns is
   * merged into the per-frame `extra` handed to preprocess and render, so a
   * demo never has to fetch the same asset per frame.
   */
  prepare?(): Promise<Record<string, unknown>>;
  /** Builds input tensors from one frame. `extra` always carries at least
   *  `{frame}` — the ImageBitmap being run — plus anything `prepare`
   *  returned. Demos that need neither may declare fewer parameters. */
  preprocess(
      mod: LiteRt, details: readonly TensorDetails[], image: ImageBitmap,
      extra?: unknown): Record<string, InstanceType<LiteRt['Tensor']>>;
  /** Draws one frame's output. `data` values are already-read TypedArrays;
   *  the tensors are deleted right after this returns. */
  render(
      ctx: OffscreenCanvasRenderingContext2D, outputDetails: readonly TensorDetails[],
      data: OutputData, extra?: unknown): void;
}

/** Call once, at module top level, from a demo's worker-entry-live.ts. */
export function runLiveWorker(handler: LiveWorkerHandler): void {
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let stopRequested = false;

  /**
   * Resolves when 'attach' delivers the frame source — or with null if 'stop'
   * arrives first, which happens whenever the visitor denies the camera
   * prompt or cancels during the ~2s WebNN compile. Null unwinds handleCompile
   * normally (deleting the compiled model, posting 'stopped') instead of
   * surfacing a cancellation as an error.
   */
  let deliverReadable: ((r: ReadableStream<VideoFrame> | null) => void) | null = null;

  function post(message: LiveWorkerToMainMessage): void {
    self.postMessage(message);
  }

  self.onmessage = (event: MessageEvent<MainToLiveWorkerMessage>) => {
    const msg = event.data;
    if (msg.type === 'init') {
      const c = msg.canvas.getContext('2d');
      if (!c) throw new Error('OffscreenCanvas 2D context unavailable in worker');
      ctx = c;
      return;
    }
    if (msg.type === 'compile') {
      void handleCompile(msg);
      return;
    }
    if (msg.type === 'attach') {
      deliverReadable?.(msg.readable);
      deliverReadable = null;
      return;
    }
    // 'stop': the loop below polls this flag between frames. It must also
    // release a compile parked waiting for 'attach', or that worker would sit
    // holding a compiled model forever and never acknowledge the stop.
    stopRequested = true;
    deliverReadable?.(null);
    deliverReadable = null;
  };

  async function handleCompile(msg: Extract<MainToLiveWorkerMessage, {type: 'compile'}>):
      Promise<void> {
    const activeCtx = ctx;
    if (!activeCtx) {
      post({type: 'error', message: 'worker not initialized'});
      return;
    }
    stopRequested = false;

    // Armed BEFORE the first await so an 'attach' that arrives while the
    // compile is still running is captured rather than dropped.
    const readablePromise = new Promise<ReadableStream<VideoFrame> | null>((resolve) => {
      deliverReadable = resolve;
    });

    try {
      const mod = await ensureLiteRt(
          msg.litertVersion, loadModeFor(msg.backend), undefined,
          (message) => post({type: 'log', message}));

      const {compiled, delegation, warnings, loadAndCompileMs} = await compileForBackend(
          mod, msg.backend, new Uint8Array(msg.modelBytes), undefined,
          (message) => post({type: 'log', message}));

      try {
        post({
          type: 'ready',
          delegation,
          warnings,
          effectiveAccelerator: compiled.options.accelerator ?? '(unknown)',
          loadAndCompileMs,
        });

        const prepared = await handler.prepare?.() ?? {};
        const inputDetails = compiled.getInputDetails();
        const outputDetails = compiled.getOutputDetails();

        // Compile is done and the receipt is already on screen; the main
        // thread acquires the track now and sends 'attach'. Null means it was
        // stopped or the source was denied — unwind cleanly, no error.
        const readable = await readablePromise;
        if (!readable || stopRequested) return;

        const reader = readable.getReader();
        let lastStatsAt = 0;
        let lastLogAt = performance.now();
        let frames = 0;
        let firstInferenceMs = 0;
        let emaFrameMs = 0;
        let lastFrameAt = 0;
        const samples: number[] = [];

        try {
          while (!stopRequested) {
            const {value: frame, done} = await reader.read();
            if (done || !frame) break;

            let image: ImageBitmap;
            try {
              image = await createImageBitmap(frame);
            } finally {
              frame.close();
            }

            // One object for both ends: a demo that draws the source frame as
            // a backdrop reads it from here rather than caching it per frame.
            const extra = {...prepared, frame: image};

            let inputs: Record<string, InstanceType<LiteRt['Tensor']>> | null = null;
            try {
              inputs = handler.preprocess(mod, inputDetails, image, extra);

              const t0 = performance.now();
              const out = await compiled.run(inputs);

              // MANDATORY readback — see measure.ts's identical comment.
              // WebGPU's run() resolves on submission, not completion; without
              // this every backend times enqueue latency, not real inference.
              const outTensors = Array.isArray(out) ? out : Object.values(out);
              const outNames = Array.isArray(out) ?
                  outputDetails.map((d) => d.name) : Object.keys(out);
              const outData = await Promise.all(outTensors.map((t) => t.data()));
              const inferenceMs = performance.now() - t0;

              const named: OutputData = {};
              outNames.forEach((name, idx) => {
                const d = outData[idx];
                if (d !== undefined) named[name] = d;
              });

              handler.render(activeCtx, outputDetails, named, extra);
              for (const t of outTensors) t.delete();

              frames++;
              if (frames === 1) firstInferenceMs = inferenceMs;
              samples.push(inferenceMs);
              if (samples.length > MAX_SAMPLES) samples.shift();

              // Achieved end-to-end frame rate, NOT 1000/inferenceMs: it
              // counts the read, preprocess, postprocess and draw the visitor
              // actually waits through, so it matches what they see on the
              // canvas. Smoothed, because an unfiltered per-frame rate is
              // unreadable.
              const now = performance.now();
              if (lastFrameAt) {
                const delta = now - lastFrameAt;
                emaFrameMs = emaFrameMs ? emaFrameMs * 0.9 + delta * 0.1 : delta;
              }
              lastFrameAt = now;
              const fps = emaFrameMs > 0 ? 1000 / emaFrameMs : 0;

              if (now - lastStatsAt >= STATS_THROTTLE_MS) {
                lastStatsAt = now;
                post({type: 'stats', inferenceMs, fps});
              }
              if (now - lastLogAt >= LOG_THROTTLE_MS) {
                lastLogAt = now;
                post({
                  type: 'log',
                  message: `${msg.backend}: ${inferenceMs.toFixed(1)} ms · ` +
                      `${fps.toFixed(1)} fps · ${frames} frames`,
                });
              }
            } finally {
              image.close();
              if (inputs) for (const t of Object.values(inputs)) t.delete();
            }
          }
        } finally {
          reader.releaseLock();
          // Session summary. The full schema goes to the devtools console per
          // CLAUDE.md's "compute all, display little"; the log panel gets one
          // compact line. Percentiles are genuinely more meaningful here than
          // on a 50-iteration discrete run — they cover thousands of frames —
          // but they are still not headline numbers, so they stay out of the
          // on-page metric rows.
          if (samples.length) {
            const metrics = computeMetrics(samples, loadAndCompileMs, firstInferenceMs);
            post({
              type: 'log',
              message: `${msg.backend}: stopped after ${frames} frames — median ` +
                  `${metrics.median_ms.toFixed(1)} ms, best ${metrics.best_ms.toFixed(1)} ms, ` +
                  `p90 ${metrics.p90_ms.toFixed(1)} ms, ` +
                  `${metrics.throughput_fps.toFixed(1)} fps avg`,
            });
            console.log(msg.backend, {
              mode: 'live', frames, sampleWindow: samples.length,
              delegation, warnings, ...metrics,
            });
          }
        }
      } finally {
        compiled.delete();
      }
    } catch (e) {
      post({type: 'error', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e)});
    } finally {
      // Track release is live-stage.ts's job — this worker never had the
      // track, only the transferred readable stream.
      deliverReadable = null;
      activeCtx.clearRect(0, 0, activeCtx.canvas.width, activeCtx.canvas.height);
      post({type: 'stopped'});
    }
  }
}
