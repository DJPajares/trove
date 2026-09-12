import { haversineMeters } from '@/lib/maps/haversine';

import type { Trip, TripDestination } from './api';
import { calendarDayDistance } from './lifecycle';

/**
 * How many days a trip covers, counting both ends.
 *
 * A trip that starts and ends on the same date is one day, not zero -
 * `calendarDayDistance` measures the gap between two dates, and a traveller
 * counts the days they are away.
 */
export function tripDayCount(trip: Trip) {
  return calendarDayDistance(trip.startDate, trip.endDate) + 1;
}

/**
 * The destinations a distance can honestly be measured between, in trip order.
 *
 * `position` rather than array order: the payload's order is the server's, and
 * a span measured down a list that had been resorted anywhere on the way here
 * would be a different number for the same trip.
 */
function locatedDestinations(destinations: readonly TripDestination[]) {
  return destinations
    .filter(
      (
        destination,
      ): destination is TripDestination & { location: { latitude: number; longitude: number } } =>
        destination.location != null,
    )
    .toSorted((left, right) => left.position - right.position);
}

/**
 * How far a trip reaches, as the crow flies, in metres.
 *
 * Straight lines between consecutive destinations, never road distance. Trove
 * buys road distances from Routes per leg and caches them, and summing those
 * across every day of every trip on a screen is precisely the per-day call
 * inside a per-trip loop that turns a home screen into a bill. This answer is
 * arithmetic over coordinates the trip payload already carried, so it costs
 * nothing - which is also why every surface showing it must say it is an
 * approximation rather than dress it up as travel distance.
 *
 * Null below two located destinations: one stop has no span, and a trip whose
 * Places have no coordinates yet has no answer rather than an answer of zero.
 */
export function tripSpanMeters(trip: Trip): number | null {
  const located = locatedDestinations(trip.destinations);
  if (located.length < 2) return null;

  let total = 0;
  for (let index = 1; index < located.length; index += 1) {
    total += haversineMeters(located[index - 1]!.location, located[index]!.location);
  }

  return total;
}

export type TripFact =
  | { kind: 'days'; count: number }
  | { kind: 'span'; meters: number }
  | { kind: 'travellers'; count: number };

/**
 * What a trip says about itself in one line, in a fixed order.
 *
 * Absent facts are dropped rather than rendered empty: a chip reading "0 km" or
 * "— travellers" tells the traveller less than no chip at all. The order is
 * fixed because these appear on several surfaces, and a row that reorders
 * itself between them reads as a different row.
 */
export function tripFacts(trip: Trip): TripFact[] {
  const span = tripSpanMeters(trip);

  return [
    { kind: 'days' as const, count: tripDayCount(trip) },
    ...(span === null ? [] : [{ kind: 'span' as const, meters: span }]),
    ...(trip.partySize > 0 ? [{ kind: 'travellers' as const, count: trip.partySize }] : []),
  ];
}
