import {loadModelBytesCached} from './opfs-cache';
import {formatProgress} from './progress-fetch';
import type {Backend, Delegation} from './types';
import type {LiveWorkerToMainMessage, MainToLiveWorkerMessage} from './live-protocol';

export interface LiveReceipt {
  delegation: Delegation;
  warnings: readonly string[];
  effectiveAccelerator: string;
  loadAndCompileMs: number;
}

export interface StartCallbacks {
  onReady: (receipt: LiveReceipt) => void;
  onStats: (inferenceMs: number, fps: number) => void;
  onLog?: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Main-thread half of a continuous demo (camera / uploaded video), shared by
 * every live demo. The worker half is runner/live.worker.ts.
 *
 * MediaStreamTrack is NOT transferable (Chrome throws "does not have a
 * transferable type" on postMessage), so MediaStreamTrackProcessor has to be
 * constructed here, on the thread where the track lives, and only its
 * .readable ReadableStream — which IS transferable — is handed over. The
 * track therefore never leaves this class, which is why THIS class, not the
 * worker, is what calls track.stop() to release the camera.
 */
export class LiveStage {
  private readonly worker: Worker;
  private readonly modelUrl: string;
  private modelBytesCache: ArrayBuffer | null = null;
  private track: MediaStreamTrack | null = null;
  private sessionListener: ((event: MessageEvent<LiveWorkerToMainMessage>) => void) | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;

  /**
   * `worker` is constructed by the caller because Vite's `?worker` import has
   * to be a static, per-demo specifier — it cannot be parameterized here.
   */
  constructor(canvas: HTMLCanvasElement, worker: Worker, modelUrl: string) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = worker;
    this.modelUrl = modelUrl;
    const init: MainToLiveWorkerMessage = {type: 'init', canvas: offscreen};
    this.worker.postMessage(init, [offscreen]);
  }

  private async loadModelBytes(
      onProgress?: (m: string) => void, onLog?: (m: string) => void): Promise<ArrayBuffer> {
    if (this.modelBytesCache) return this.modelBytesCache;
    const {bytes} = await loadModelBytesCached(
        this.modelUrl, onLog, (p) => onProgress?.(`fetching model… ${formatProgress(p)}`));
    this.modelBytesCache = bytes;
    return this.modelBytesCache;
  }

  /**
   * Downloads and compiles the model, and ONLY THEN calls `acquireTrack` to
   * open the camera / start the uploaded video. That order is deliberate:
   * compiling takes ~2s on WebNN, and doing it with the source already
   * running lit the camera indicator (or played the video unwatched) for
   * seconds before a single frame was used.
   *
   * `acquireTrack` is a callback rather than a plain track parameter for
   * exactly that reason — the caller still owns HOW to get a track
   * (getUserMedia, or an uploaded <video>'s captureStream()), but this class
   * owns WHEN. Once it returns one, this class owns stopping it, in
   * stop()/dispose(). Resolves when the loop is actually running; the 'ready'
   * receipt fires part-way through, before the source is touched, so the
   * visitor sees what they are about to run on while permission is asked.
   *
   * getUserMedia does not require transient activation, so it is safe for a
   * caller's callback to invoke it after this method's awaits — but keep the
   * call path rooted in a click handler anyway, so the permission prompt
   * stays tied to an action the visitor took.
   */
  async start(
      acquireTrack: () => Promise<MediaStreamTrack>, backend: Backend, litertVersion: string,
      callbacks: StartCallbacks, onProgress?: (message: string) => void): Promise<void> {
    const modelBytes = await this.loadModelBytes(onProgress, callbacks.onLog);

    this.detachSessionListener();
    const onMessage = (event: MessageEvent<LiveWorkerToMainMessage>): void => {
      const msg = event.data;
      if (msg.type === 'log') {
        callbacks.onLog?.(msg.message);
      } else if (msg.type === 'ready') {
        callbacks.onReady({
          delegation: msg.delegation,
          warnings: msg.warnings,
          effectiveAccelerator: msg.effectiveAccelerator,
          loadAndCompileMs: msg.loadAndCompileMs,
        });
        this.resolveReady?.();
      } else if (msg.type === 'stats') {
        callbacks.onStats(msg.inferenceMs, msg.fps);
      } else if (msg.type === 'error') {
        callbacks.onError(msg.message);
        this.rejectReady?.(new Error(msg.message));
      }
      // 'stopped' is handled by stop()'s own listener, not here — this
      // listener stays registered for the whole live session (stats keep
      // arriving after start() resolves), so it can't also be the one that
      // resolves stop()'s promise without racing it.
    };
    this.sessionListener = onMessage;
    this.worker.addEventListener('message', onMessage);

    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    onProgress?.('compiling model…');
    const compileMsg: MainToLiveWorkerMessage = {
      type: 'compile', backend, litertVersion, modelBytes: modelBytes.slice(0),
    };
    this.worker.postMessage(compileMsg, [compileMsg.modelBytes]);
    await ready;

    // Compiled and ready — start the camera / video only now.
    onProgress?.('starting video source…');
    let track: MediaStreamTrack;
    try {
      track = await acquireTrack();
    } catch (e) {
      // The worker is parked holding a compiled model waiting for 'attach';
      // release it or it never acknowledges a later stop.
      this.worker.postMessage({type: 'stop'} satisfies MainToLiveWorkerMessage);
      throw e;
    }
    this.track = track;

    // Constructed here (not in the worker) because MediaStreamTrackProcessor
    // needs the actual track, which never leaves this thread — only its
    // .readable stream (transferable) is handed over below.
    const processor = new MediaStreamTrackProcessor({track});
    const attachMsg: MainToLiveWorkerMessage = {type: 'attach', readable: processor.readable};
    this.worker.postMessage(attachMsg, [attachMsg.readable]);
  }

  /** Without this, every start() left its listener attached and `onStats`
   *  fired once per past session on every message — the metric row visibly
   *  thrashed after a few backend switches. */
  private detachSessionListener(): void {
    if (this.sessionListener) this.worker.removeEventListener('message', this.sessionListener);
    this.sessionListener = null;
  }

  /** Stops the live loop and releases the track. The track is stopped right
   *  here on the main thread (see class doc comment) — resolving waits only
   *  on the worker's 'stopped' to confirm ITS resources (reader, compiled
   *  model) are released too, so the caller can safely start a different
   *  backend or source once this resolves without two loops overlapping. */
  stop(): Promise<void> {
    this.track?.stop();
    this.track = null;
    this.detachSessionListener();
    return new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent<LiveWorkerToMainMessage>): void => {
        if (event.data.type === 'stopped') {
          this.worker.removeEventListener('message', onMessage);
          resolve();
        }
      };
      this.worker.addEventListener('message', onMessage);
      const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
      this.worker.postMessage(stopMsg);
    });
  }

  dispose(): void {
    this.track?.stop();
    this.track = null;
    this.detachSessionListener();
    // Best effort — a page unload doesn't get to wait for 'stopped'.
    const stopMsg: MainToLiveWorkerMessage = {type: 'stop'};
    this.worker.postMessage(stopMsg);
    this.worker.terminate();
  }
}

/** getUserMedia + its first video track. Shared: every live demo asks for
 *  exactly this. Tears the stream down rather than leaking it if a granted
 *  stream somehow carries no video track. */
export async function acquireCameraTrack(): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
  const [track] = stream.getVideoTracks();
  if (!track) {
    for (const t of stream.getTracks()) t.stop();
    throw new Error('getUserMedia returned no video track');
  }
  return track;
}

/**
 * A track from an uploaded video's own playback. LiveStage treats it exactly
 * like a camera track — both are plain MediaStreamTracks, which is what lets
 * one loop cover both sources.
 *
 * Returns a CLONE, never the element's own track. LiveStage owns stopping
 * whatever it is given, and a stopped track is dead forever — but
 * captureStream() on a media element may hand back the same cached stream on
 * every call, so stopping the original would make the SECOND Start silently
 * produce no frames (compile succeeds, 'ready' fires, the reader sees done
 * immediately, canvas stays blank). Stopping a clone leaves the element's
 * track live for the next Start.
 *
 * The video must be muted, so play() needs no transient activation and is
 * safe to call after LiveStage's compile await.
 */
export async function acquireVideoFileTrack(video: HTMLVideoElement): Promise<MediaStreamTrack> {
  await video.play();
  const stream = video.captureStream();
  const [track] = stream.getVideoTracks();
  if (!track) throw new Error('video file has no video track');
  return track.clone();
}
