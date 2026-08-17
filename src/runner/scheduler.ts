/**
 * Single-flight run scheduler.
 *
 * M1 scope: one demo, one worker, backends selected sequentially by the
 * visitor. This guards exactly that — if a run is in flight and the visitor
 * switches backend before it finishes, the stale run is aborted and its
 * result is marked non-current so the UI never renders an out-of-date row
 * over a fresher selection.
 *
 * NOT the M2 primitive. The compare view needs to serialize N *already-live*
 * workers so only one measures at a time (contention, not staleness) — a
 * queue/mutex, not a cancel-and-replace. Do not stretch this class to do that
 * job; write `CompareScheduler` alongside it when M2 needs it instead of
 * overloading this one to mean two different things.
 */
export class MeasurementScheduler {
  private current: {token: symbol; controller: AbortController} | null = null;

  /**
   * Starts a new run slot, aborting whatever was previously in flight.
   * Returns the signal the new run must respect, and `isCurrent()` — check it
   * before acting on a result, since an aborted run may still resolve with
   * partial data after a newer run has already started.
   */
  start(): {signal: AbortSignal; isCurrent: () => boolean} {
    this.current?.controller.abort();
    const token = Symbol('measurement');
    const controller = new AbortController();
    this.current = {token, controller};
    return {signal: controller.signal, isCurrent: () => this.current?.token === token};
  }

  /** For disposal (e.g. the demo page is being torn down). */
  cancelCurrent(): void {
    this.current?.controller.abort();
    this.current = null;
  }
}
