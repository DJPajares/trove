/**
 * When a built map is kept rather than rebuilt.
 *
 * Google bills Dynamic Maps per `new maps.Map()`, so a map that has been paid
 * for is kept alive, hidden, while the traveller looks at something else, and
 * shown again for free. These rules are pure so they can be tested without a
 * browser; the components only apply their answers.
 */

export type ItineraryViewName = 'day' | 'overview';

/**
 * The itinerary's planning map.
 *
 * - `visible`: the map is on screen now (desktop shows it beside the day; a
 *   phone shows it on its Map tab).
 * - `mount`: the map exists. Once built it stays, hidden, off the Day view.
 * - `renderDayView`: the Day view stays in the tree while a map lives in it, so
 *   that returning to Day finds the map exactly as it was left. With no map
 *   built there is nothing to keep and Overview replaces it as before.
 */
export function planningMapLifecycle(input: {
  activeView: ItineraryViewName;
  desktopMapLayout: boolean | null;
  mobileView: 'list' | 'map';
  mounted: boolean;
}) {
  const visible =
    input.activeView === 'day' && (input.desktopMapLayout === true || input.mobileView === 'map');

  return {
    mount: visible || input.mounted,
    renderDayView: input.activeView === 'day' || input.mounted,
    visible,
  };
}

/**
 * The whole trip's map, on the Overview. It is opt-in at every width, so it is
 * built only once the traveller asks for it, then kept, hidden, behind the
 * itinerary list and behind the Day view.
 *
 * - `visible`: the map is on screen now.
 * - `mount`: the map exists. Once built it stays.
 * - `renderOverview`: the Overview stays in the tree while a map lives in it, so
 *   coming back to it finds the map exactly as it was left.
 */
export function overviewMapLifecycle(input: {
  activeView: ItineraryViewName;
  display: 'list' | 'map';
  mounted: boolean;
}) {
  const visible = input.activeView === 'overview' && input.display === 'map';

  return {
    mount: visible || input.mounted,
    renderOverview: input.activeView === 'overview' || input.mounted,
    visible,
  };
}

/**
 * Trip Mode's Map tab. Its views are routes, so the map lives in the shell:
 * built on the first visit to the tab and kept, hidden, on the other views.
 */
export function tripModeMapLifecycle(input: { onMapView: boolean; visited: boolean }) {
  return { active: input.onMapView, render: input.onMapView || input.visited };
}

/**
 * A hidden map must not see its inputs change. The map is built from its first
 * point, and it swaps itself for an empty state when it has none, so a hidden
 * map whose day quietly emptied would rebuild itself - and be billed - on its
 * return. While suspended it keeps working from what it last showed.
 */
export function retainWhileSuspended<T>(live: T, suspended: boolean, lastShown: T): T {
  return suspended ? lastShown : live;
}
