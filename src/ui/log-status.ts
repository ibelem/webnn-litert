/**
 * Append-only, timestamped log for the `#log-status` panel — every backend's
 * full run transcript stays visible and scrolls, rather than being replaced
 * by the next backend's summary. Fed by measure.ts's `onLog` callback (via
 * each demo's worker) and by the main-thread OPFS cache lookup, so a run's
 * full detail (compile start, per-iteration counters, final stats) shows up
 * as it happens — matching the two on-page metrics staying minimal per
 * CLAUDE.md's "compute all, display little" rule.
 */

const MAX_LINES = 500;

export interface Logger {
  log(message: string): void;
  clear(): void;
}

export function createLogger(logStatusEl: HTMLElement | null): Logger {
  const lines: string[] = [];

  function render(): void {
    if (!logStatusEl) return;
    logStatusEl.textContent = lines.join('\n');
    logStatusEl.scrollTop = logStatusEl.scrollHeight;
  }

  return {
    log(message: string): void {
      lines.push(`${timestamp()} ${message}`);
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      render();
    },
    clear(): void {
      lines.length = 0;
      render();
    },
  };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
