import type {Backend, Delegation} from '../../runner/types';

/**
 * Not shared with runner/worker-protocol.ts on purpose — that protocol is
 * shaped entirely around a discrete N-iteration measured run
 * (measureBackend). This demo compiles once and then loops indefinitely
 * against a live camera track instead, which is a different enough shape
 * of "run" that forcing it into the shared protocol would bend that one
 * for a single caller. See compare-controller.ts's own doc comment for the
 * same reasoning applied to selfie-multiclass.
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
  /**
   * Transferred, not copied. MediaStreamTrack itself is NOT transferable
   * (Chrome throws "does not have a transferable type") — the actual
   * pattern is to construct MediaStreamTrackProcessor on the main thread,
   * where the track lives, and transfer its .readable stream instead;
   * ReadableStream is transferable. The track stays on the main thread,
   * which is why camera release (track.stop()) lives in stage.ts, not the
   * worker.
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

/** Throttled to a few times a second, not per-frame — see worker-entry.ts. */
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
 *  own resources (reader, compiled model) are released — the main thread
 *  waits for this before letting the visitor start a new backend, so two
 *  loops never overlap. Camera release is the main thread's own job (see
 *  LiveStartMessage's doc comment), not gated on this message. */
export interface LiveStoppedMessage {
  type: 'stopped';
}

export type LiveWorkerToMainMessage =
    LiveReadyMessage | LiveStatsMessage | LiveLogMessage | LiveErrorMessage | LiveStoppedMessage;
