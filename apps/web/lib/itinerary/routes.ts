import type { ItineraryDay } from './api';

type RevisionDay = Pick<
  ItineraryDay,
  | 'dailyBaseDepartureTripPlaceId'
  | 'dailyBaseTripPlaceId'
  | 'id'
  | 'items'
  | 'routeStartTravelMode'
  | 'stay'
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
 * The order is carried by the string's own order, never by `position`. The
 * server renumbers a day's positions when it reorders it and leaves gaps on a
 * day a stop left, while an optimistic reorder on the device numbers from
 * zero; a signature that read positions would see two different days where
 * there is one, and ask for - and pay for - the same legs twice.
 *
 * The Stay the server inferred from a booking counts too: it is where the
 * first leg leaves from and the last one returns to, whether or not a base
 * was set by hand.
 */
export function itineraryDayRouteRevision(day: RevisionDay | null): string {
  if (!day) return '';
  return [
    day.id,
    day.dailyBaseTripPlaceId ?? '',
    day.dailyBaseDepartureTripPlaceId ?? '',
    day.stay?.startTripPlaceId ?? '',
    day.stay?.endTripPlaceId ?? '',
    day.routeStartTravelMode,
    ...day.items.flatMap((item) => [
      item.id,
      item.tripPlace?.id ?? '',
      item.travelModeToNext ?? '',
    ]),
  ].join(':');
}
