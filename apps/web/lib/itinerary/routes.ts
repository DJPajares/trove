import type { ItineraryDay } from './api';

type RevisionDay = Pick<
  ItineraryDay,
  'dailyBaseDepartureTripPlaceId' | 'dailyBaseTripPlaceId' | 'id' | 'items' | 'routeStartTravelMode'
>;

/**
 * Everything a day's travel legs are derived from, as one comparable string.
 *
 * Legs are never stored: the API rebuilds the chain from the day's items in
 * position order on every request. So anything that changes the chain — the
 * order itself, which Place an item points at, the bases the day starts and
 * ends at, the travel modes — has to change this signature, or a leg computed
 * for one ordering can be presented as the answer for another.
 *
 * The item order is carried by the string's own order rather than by `position`
 * alone, so a signature stays honest even if positions are ever renumbered
 * without changing.
 */
export function itineraryDayRouteRevision(day: RevisionDay | null): string {
  if (!day) return '';
  return [
    day.id,
    day.dailyBaseTripPlaceId ?? '',
    day.dailyBaseDepartureTripPlaceId ?? '',
    day.routeStartTravelMode,
    ...day.items.flatMap((item) => [
      item.id,
      String(item.position),
      item.tripPlace?.id ?? '',
      item.travelModeToNext ?? '',
    ]),
  ].join(':');
}
