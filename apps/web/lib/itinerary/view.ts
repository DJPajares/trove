export type ItineraryViewState =
  | { invalidRequestedDay: false; selectedDayId: string; view: 'day' }
  | { invalidRequestedDay: boolean; selectedDayId: null; view: 'overview' };

/**
 * The URL is the public view contract: a valid day opens focused planning,
 * while the plain itinerary route is the whole-trip overview.
 */
export function resolveItineraryView(
  requestedDayId: string | null,
  dayIds: readonly string[],
): ItineraryViewState {
  if (requestedDayId === null) {
    return { invalidRequestedDay: false, selectedDayId: null, view: 'overview' };
  }

  if (dayIds.includes(requestedDayId)) {
    return { invalidRequestedDay: false, selectedDayId: requestedDayId, view: 'day' };
  }

  return { invalidRequestedDay: true, selectedDayId: null, view: 'overview' };
}

/** Preserve any future itinerary query state while changing only its view. */
export function itineraryViewHref(pathname: string, search: string, dayId: string | null): string {
  const params = new URLSearchParams(search);

  if (dayId) params.set('day', dayId);
  else params.delete('day');

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
