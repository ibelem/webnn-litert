/// <reference lib="webworker" />

/**
 * Bespoke worker for object-detection's live mode (camera or uploaded
 * video) — does NOT use runner/litert.worker.ts's runDemoWorker, which is
 * shaped around measureBackend's discrete N-iteration run. This compiles
 * once, then loops indefinitely against a transferred
 * MediaStreamTrackProcessor .readable stream until told to stop. Mirrors
 * efficientvit-live/worker-entry.ts — see its doc comment for the full
 * reasoning.
 *
 * MUST stay a classic worker (imported via `?worker`, never
 * `{type: 'module'}`) — LiteRT's Emscripten loader calls importScripts(),
 * which module workers reject. See demos/depth-anything/worker-entry.ts.
 */
import type {LiteRt} from '../../runner/loader';
import {ensureLiteRt} from '../../runner/loader';
import {compileForBackend, loadModeFor, type OutputData} from '../../runner/measure';
import {preprocessYolo26} from './preprocess';
import {renderYolo26} from './render';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './live-protocol';

declare const self: DedicatedWorkerGlobalScope;

// ~6-7 updates/sec — legible on the metric row without jittering it every
// frame, same spirit as measure.ts throttling its "Inferencing i/n" lines.
const STATS_THROTTLE_MS = 150;

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let stopRequested = false;

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
  if (msg.type === 'start') {
    void handleStart(msg);
    return;
  }
  // 'stop': the loop below polls this flag between frames.
  stopRequested = true;
};

async function handleStart(msg: Extract<MainToLiveWorkerMessage, {type: 'start'}>): Promise<void> {
  const activeCtx = ctx;
  if (!activeCtx) {
    post({type: 'error', message: 'worker not initialized'});
    return;
  }
  stopRequested = false;

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

      const inputDetails = compiled.getInputDetails();
      const outputDetails = compiled.getOutputDetails();

      const reader = msg.readable.getReader();
      let lastStatsAt = 0;

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

          let inputs: Record<string, InstanceType<LiteRt['Tensor']>> | null = null;
          try {
            inputs = preprocessYolo26(mod, inputDetails, image);

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

            renderYolo26(activeCtx, outputDetails, named, {labels: msg.labels, frame: image});
            for (const t of outTensors) t.delete();

            const now = performance.now();
            if (now - lastStatsAt >= STATS_THROTTLE_MS) {
              lastStatsAt = now;
              post({type: 'stats', inferenceMs});
            }
          } finally {
            image.close();
            if (inputs) for (const t of Object.values(inputs)) t.delete();
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      compiled.delete();
    }
  } catch (e) {
    post({type: 'error', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e)});
  } finally {
    // Track release is stage-live.ts's job — this worker never had the
    // track, only the transferred readable stream.
    activeCtx.clearRect(0, 0, activeCtx.canvas.width, activeCtx.canvas.height);
    post({type: 'stopped'});
  }
}
