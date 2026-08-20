/**
 * Updates the log-status element with inference times for each backend.
 * Shows individual inference times based on the inference count setting.
 */

export interface BackendInferenceTimes {
  backend: string;
  times: number[];
  error?: string;
}

export function updateLogStatus(
  logStatusEl: HTMLElement | null,
  backendTimes: BackendInferenceTimes[],
  inferenceCount: number
): void {
  if (!logStatusEl) return;

  if (backendTimes.length === 0) {
    logStatusEl.textContent = 'No inference data available';
    return;
  }

  const lines: string[] = [];

  for (const {backend, times, error} of backendTimes) {
    if (error) {
      lines.push(`${backend}: Error - ${error}`);
    } else if (times.length === 0) {
      lines.push(`${backend}: No data`);
    } else {
      // Show individual inference times, limited to the inference count
      const displayTimes = times.slice(0, inferenceCount);
      const timesStr = displayTimes.map(t => t.toFixed(1)).join(', ');
      lines.push(`${backend}: [${timesStr}]`);
    }
  }

  logStatusEl.textContent = lines.join('\n');
}
