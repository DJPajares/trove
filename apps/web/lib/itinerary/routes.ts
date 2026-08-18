import type { Itinerary, ItineraryDay } from './api';

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

type PlanScoreRevisionDay = RevisionDay & Pick<ItineraryDay, 'date'>;

/**
 * What Plan Score is actually computed from: the leg chain, plus the timing and
 * priority the score reads directly.
 *
 * This is deliberately not the route signature. Scoring a trip costs a provider
 * request for every place on every day, so keying it on a whole item — as an
 * `updatedAt` does — meant renaming a note or correcting a planned cost
 * re-scored the entire trip. Listing the inputs by name means a field that
 * cannot move the score cannot trigger the work either.
 */
export function itineraryPlanScoreRevision(itinerary: Itinerary | null): string {
  if (!itinerary) return '';
  return itinerary.days
    .map((day: PlanScoreRevisionDay) =>
      [
        itineraryDayRouteRevision(day),
        day.date,
        ...day.items.flatMap((item) => [
          item.dayPart ?? '',
          String(item.durationMinutes ?? ''),
          item.localStartTime ?? '',
          item.priority ?? '',
          item.startInstant ?? '',
          item.timeSemantics ?? '',
        ]),
      ].join(':'),
    )
    .join('|');
}
