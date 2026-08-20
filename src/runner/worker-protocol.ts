import type {Backend, RunRecord} from './types';

/**
 * Messages between the main thread and litert.worker.ts. Everything crossing
 * this boundary must be structurally cloneable or transferable — no DOM
 * nodes, no functions, no class instances with methods.
 *
 * `modelBytes` and `rgba` are transferred (not copied): the main thread loses
 * access to them after posting. That's intentional — this data is large and
 * copying it would defeat the point of moving work off the main thread.
 */
export interface InitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
  /**
   * If true, the worker will return output data via 'render-data' messages
   * instead of rendering to canvas. Used for DOM-based demos (e.g., text
   * classification).
   */
  domMode?: boolean;
}

export interface RunMessage {
  type: 'run';
  requestId: string;
  backend: Backend;
  litertVersion: string;
  modelBytes: ArrayBuffer;
  iterations: number;
  warmupRuns: number;
  /**
   * Full-resolution source image, transferred (not copied). `ImageBitmap` is
   * transferable and workers CAN create their own `OffscreenCanvas` and call
   * `drawImage`/`getImageData` — so resizing to the model's actual input
   * shape happens inside the worker, after the model is compiled and
   * `getInputDetails()` reveals what that shape is. The main thread cannot
   * know the target size ahead of compiling, so it must not pre-resize.
   */
  image: ImageBitmap;
  /**
   * Optional demo-specific static data preprocess/render need beyond the
   * image itself — e.g. mobilenetv2's label list, which the worker cannot
   * fetch on its own (a classic worker's bundled script is an IIFE, so it
   * can't use top-level await, and threading a fetch through render()'s
   * synchronous callback would require reworking measureBackend's hooks for
   * one demo's needs). The main thread fetches it once, alongside the model.
   */
  extra?: unknown;
}

export type MainToWorkerMessage = InitMessage | RunMessage;

export interface RecordMessage {
  type: 'record';
  requestId: string;
  record: RunRecord;
}

export interface WorkerErrorMessage {
  type: 'worker-error';
  requestId: string;
  message: string;
}

/**
 * One incremental log line from measureBackend's progress (compile start,
 * per-iteration counters, final stats) — see log-status.ts. Sent as its own
 * message rather than folded into 'record' so the log-status panel can grow
 * in real time instead of appearing all at once when the run finishes.
 */
export interface LogMessage {
  type: 'log';
  requestId: string;
  message: string;
}


/**
 * Message for demos that render via DOM instead of canvas (e.g., text-based
 * classification). Returns the raw output data so the main thread can render
 * it into HTML elements.
 */
export interface RenderDataMessage {
  type: 'render-data';
  requestId: string;
  outputDetails: readonly {
    name: string;
    shape: readonly number[];
    dtype: string;
  }[];
  data: Record<string, Float32Array | Int32Array | Uint8Array | readonly number[]>;
  extra?: unknown;
}

export type WorkerToMainMessage =
    RecordMessage | WorkerErrorMessage | RenderDataMessage | LogMessage;
