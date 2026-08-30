export type ItineraryViewState =
  | { invalidRequestedDay: boolean; selectedDayId: string; view: 'day' }
  | { invalidRequestedDay: boolean; selectedDayId: null; view: 'overview' };

/**
 * The URL is the public view contract: the itinerary opens on the day you plan
 * in, and the whole-trip read is the one you ask for by name.
 *
 * A trip with no days has no day to open, and only the overview carries an empty
 * state, so it falls back there whatever the URL says.
 */
export function resolveItineraryView(
  requestedView: string | null,
  requestedDayId: string | null,
  dayIds: readonly string[],
): ItineraryViewState {
  const firstDayId = dayIds[0];

  if (requestedView === 'overview' || firstDayId === undefined) {
    return { invalidRequestedDay: false, selectedDayId: null, view: 'overview' };
  }

  if (requestedDayId === null) {
    return { invalidRequestedDay: false, selectedDayId: firstDayId, view: 'day' };
  }

  if (dayIds.includes(requestedDayId)) {
    return { invalidRequestedDay: false, selectedDayId: requestedDayId, view: 'day' };
  }

  // A stale shared link is not a different view. Open the first day and let the
  // URL be corrected, rather than silently planning the wrong one.
  return { invalidRequestedDay: true, selectedDayId: firstDayId, view: 'day' };
}

/** Preserve any future itinerary query state while changing only its view. */
export function itineraryViewHref(pathname: string, search: string, dayId: string | null): string {
  const params = new URLSearchParams(search);

  if (dayId) {
    params.set('day', dayId);
    params.delete('view');
  } else {
    params.set('view', 'overview');
    params.delete('day');
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
