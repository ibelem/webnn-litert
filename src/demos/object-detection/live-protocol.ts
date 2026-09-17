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

/**
 * Deliberately carries NO frame source. Compile is split from attach so the
 * camera (or an uploaded video's playback) does not start until the model is
 * downloaded and compiled: WebNN's graph build alone is ~2 seconds, and a
 * single combined message forced the camera light on for that whole time
 * before a single frame was used. The worker replies 'ready' when the
 * compile is done; only then does stage-live.ts acquire the track and send
 * 'attach'.
 */
export interface LiveCompileMessage {
  type: 'compile';
  backend: Backend;
  litertVersion: string;
  modelBytes: ArrayBuffer;
}

/**
 * Hands the compiled-and-waiting worker its frame source, starting the loop.
 * Sent only after 'ready'.
 */
export interface LiveAttachMessage {
  type: 'attach';
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

export type MainToLiveWorkerMessage =
    LiveInitMessage | LiveCompileMessage | LiveAttachMessage | LiveStopMessage;

/** The delegation receipt — sent once, right after compile and before the
 *  frame source is even acquired. Never show a live inference number without
 *  this: the same rule as every other demo, applied to a continuous one. It
 *  is also the main thread's cue that compiling is finished and it may now
 *  open the camera or start the video (see LiveCompileMessage). */
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
  /** Achieved end-to-end frame rate, smoothed. NOT 1000/inferenceMs: it
   *  includes frame read, preprocess, postprocess and draw, so it matches
   *  what the visitor sees on the canvas rather than kernel time. */
  fps: number;
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
