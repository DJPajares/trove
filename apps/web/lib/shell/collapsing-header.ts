/**
 * Matches `--header-height` in `globals.css`. Below this the header is always
 * shown, so the top of a page never opens with its chrome already hidden.
 */
export const COLLAPSE_AFTER_PX = 64;

/**
 * Momentum and rubber-band scrolling report a jitter of a pixel or two in the
 * opposite direction. Without a floor the header flickers while a finger is
 * still resting on the screen.
 */
const SCROLL_DEAD_ZONE_PX = 4;

export type HeaderScrollState = {
  collapsed: boolean;
  lastOffset: number;
};

/**
 * Decides whether the app header should be showing, given where the page was
 * and where it is now.
 *
 * The header follows the scroll direction once past the fold, and any upward
 * movement brings it straight back — a traveller who wants the header should
 * not have to scroll all the way to the top of a long day plan for it.
 *
 * Pure, so the direction rules can be tested without a DOM.
 */
export function nextHeaderScrollState(
  state: HeaderScrollState,
  offset: number,
  collapseAfter: number = COLLAPSE_AFTER_PX,
): HeaderScrollState {
  // iOS reports a negative offset while over-scrolling past the top.
  const clamped = Math.max(0, offset);

  if (clamped <= collapseAfter) {
    return { collapsed: false, lastOffset: clamped };
  }

  const delta = clamped - state.lastOffset;

  // Hold `lastOffset` so a run of sub-threshold moves still accumulates into a
  // real direction instead of being discarded one by one.
  if (Math.abs(delta) < SCROLL_DEAD_ZONE_PX) {
    return state;
  }

  return { collapsed: delta > 0, lastOffset: clamped };
}
