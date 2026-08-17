/**
 * LOCKED COMPONENT. No style-override parameter, no size variant, no class
 * passthrough — on purpose. See receipt-badge.ts for why: these two
 * components are what make the site's numbers legible and comparable across
 * every demo page, and that only holds if nothing can restyle them per-page.
 *
 * Exactly two of these appear per demo, per CLAUDE.md's "on-page — exactly
 * two metrics" rule: loadAndCompile time and inference time. Everything else
 * computed goes to console.log, never here.
 */
export function renderMetricRow(
    container: HTMLElement, label: string, valueMs: number | null, suppressed: boolean): void {
  container.replaceChildren();
  container.className = 'metric-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'metric-row__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = suppressed ? 'metric-row__value num suppressed' : 'metric-row__value num';
  // Latency from a partial/failed delegation is not a WebNN number — shown
  // for completeness, styled so it never reads as a headline.
  valueEl.textContent = valueMs === null ? '—' : `${valueMs.toFixed(1)} ms`;

  container.append(labelEl, valueEl);
}
