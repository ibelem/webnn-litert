/**
 * Copies the compare grid's backend selection onto live mode's radios when
 * switching into Video/Camera.
 *
 * The two are genuinely separate controls — image mode is a multi-select set
 * of checkboxes (compare N backends), live mode a single-select radio group
 * (only one backend can be live at a time) — and only one of them is on
 * screen at a time. Both used to be titled just "Backend", so ticking WebNN
 * GPU and then switching to Video file showed an empty "Backend" group, which
 * reads as the page having silently cleared the choice. Nothing cleared
 * anything: it is a different control that was never set.
 *
 * Carries over ONLY when the live group has nothing selected yet, so an
 * explicit live choice is never clobbered by a later tick in the compare
 * grid. Pairs with the group titles, which now say which is which.
 */
export function carryOverBackend(
    compareBoxes: readonly HTMLInputElement[],
    liveRadios: readonly HTMLInputElement[]): void {
  if (liveRadios.some((radio) => radio.checked)) return;
  const first = compareBoxes.find((box) => box.checked);
  if (!first) return;
  for (const radio of liveRadios) radio.checked = radio.value === first.value;
}
