import type {Backend, Delegation} from '../../runner/types';

/**
 * Not shared with runner/worker-protocol.ts on purpose — that protocol is
 * shaped entirely around a discrete N-iteration measured run
 * (measureBackend). This mode compiles once and then loops indefinitely
 * against a live track instead (camera, or an uploaded video's
 * captureStream() — both produce a MediaStreamTrack, so one loop covers
 * both). See efficientvit-live/protocol.ts for the pattern this mirrors.
 */
export interface LiveInitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
}

export interface LiveStartMessage {
  type: 'start';
  backend: Backend;
  litertVersion: string;
  modelBytes: ArrayBuffer;
  /** Fetched once by the stage — the worker has no way to fetch this
   *  itself, same reasoning as RunMessage.extra in worker-protocol.ts. */
  labels: readonly string[];
  /**
   * Transferred, not copied. MediaStreamTrack itself is NOT transferable
   * (Chrome throws "does not have a transferable type") — the stage
   * constructs MediaStreamTrackProcessor on the main thread, where the
   * track lives, and transfers only its .readable stream (transferable).
   * The track never leaves the main thread — see stage-live.ts.
   */
  readable: ReadableStream<VideoFrame>;
}

export interface LiveStopMessage {
  type: 'stop';
}

export type MainToLiveWorkerMessage = LiveInitMessage | LiveStartMessage | LiveStopMessage;

/** The delegation receipt — sent once, right after compile and before the
 *  loop starts. Never show a live inference number without this: the same
 *  rule as every other demo, applied to a continuous one. */
export interface LiveReadyMessage {
  type: 'ready';
  delegation: Delegation;
  warnings: readonly string[];
  effectiveAccelerator: string;
  loadAndCompileMs: number;
}

/** Throttled to a few times a second, not per-frame — see worker-entry-live.ts. */
export interface LiveStatsMessage {
  type: 'stats';
  inferenceMs: number;
}

export interface LiveLogMessage {
  type: 'log';
  message: string;
}

export interface LiveErrorMessage {
  type: 'error';
  message: string;
}

/** Acknowledges a 'stop' once the loop has actually broken and the worker's
 *  own resources (reader, compiled model) are released. Track release is
 *  the main thread's job (see LiveStartMessage's doc comment). */
export interface LiveStoppedMessage {
  type: 'stopped';
}

export type LiveWorkerToMainMessage =
    LiveReadyMessage | LiveStatsMessage | LiveLogMessage | LiveErrorMessage | LiveStoppedMessage;
