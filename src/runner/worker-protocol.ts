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

export type WorkerToMainMessage = RecordMessage | WorkerErrorMessage;
