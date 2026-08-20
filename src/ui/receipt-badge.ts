import type {Delegation} from '../runner/types';

/**
 * LOCKED COMPONENT. No style-override parameter, no size variant, no class
 * passthrough — on purpose. This badge is the receipt that makes the site's
 * two on-page numbers trustworthy; see CLAUDE.md, "the one rule that
 * matters". A PR that adds a way to shrink or restyle it is a bug, not a
 * feature. All visual variation comes from `tokens.css` alone.
 *
 * `full` is deliberately the QUIET state — see DESIGN.md, "why fully
 * delegated is the quiet state". Under our JSPI-always target, partial
 * delegation is the expected outcome for WebNN, not an edge case, so the
 * badge must not read as broken when it appears.
 */
const DELEGATION_TEXT: Record<Delegation, string> = {
  full: 'Fully delegated',
  partial: 'Partially delegated — some ops ran on CPU',
  failed: 'Did not run',
};

export function renderReceiptBadge(
    container: HTMLElement, delegation: Delegation, warnings: readonly string[], error?: string): void {
  container.replaceChildren();
  container.className = `receipt-badge receipt-badge--${delegation}`;

  const text = document.createElement('span');
  text.className = 'receipt-badge__text';
  text.textContent = DELEGATION_TEXT[delegation];
  container.append(text);

  // Partial delegation is reported ONLY via console.warn — surfacing it here
  // is half the evidence this project's credibility rests on.
  if (delegation === 'partial' && warnings.length > 0) {
    const detail = document.createElement('span');
    detail.className = 'receipt-badge__detail';
    detail.textContent = warnings[0] ?? '';
    container.append(detail);
  }

  // Show actual error message when delegation failed
  if (delegation === 'failed' && error) {
    const detail = document.createElement('span');
    detail.className = 'receipt-badge__detail';
    detail.textContent = error;
    container.append(detail);
  }
}
