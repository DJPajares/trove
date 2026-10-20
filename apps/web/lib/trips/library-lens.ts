import type { Trip } from './api';
import { groupTripsForLibrary } from './lifecycle';

/**
 * Ways to narrow the Trips library. `all` is the library itself; the others
 * are lenses on it. Upcoming is the calendar of what is ahead, Needs planning
 * the to-do list within it - they overlap on purpose. Ready is the traveller's
 * own marker (PRD 6.2), so Needs planning never judges a plan on their behalf.
 */
export type TripLens = 'all' | 'upcoming' | 'planning' | 'past';
export const TRIP_LENSES: readonly TripLens[] = ['all', 'upcoming', 'planning', 'past'];

/** A library smaller than this is read at a glance and offers no lenses. */
export const LENS_MIN_TRIPS = 6;

export function parseTripLens(value: string | null | undefined): TripLens {
  return TRIP_LENSES.includes(value as TripLens) ? (value as TripLens) : 'all';
}

/** The trips a lens shows, in the order that lens is read in. */
export function tripsForLens(trips: Trip[], lens: TripLens, now = new Date()): Trip[] {
  const { ahead, featured, past } = groupTripsForLibrary(trips, now);
  // Under way first, then soonest departure: the featured trip leads `ahead`.
  const upcoming = featured ? [featured, ...ahead] : ahead;
  switch (lens) {
    case 'upcoming':
      return upcoming;
    case 'planning':
      return upcoming
        .filter((trip) => trip.lifecycle === 'planning' && trip.planningReadiness === 'in_progress')
        .toSorted((left, right) => left.startDate.localeCompare(right.startDate));
    case 'past':
      return past;
    default:
      return trips;
  }
}

export function lensCounts(trips: Trip[], now = new Date()): Record<TripLens, number> {
  return {
    all: trips.length,
    past: tripsForLens(trips, 'past', now).length,
    planning: tripsForLens(trips, 'planning', now).length,
    upcoming: tripsForLens(trips, 'upcoming', now).length,
  };
}

/** Lenses are offered once there is enough to narrow, and more than one way to. */
export function showLensFilter(trips: Trip[], now = new Date()): boolean {
  if (trips.length < LENS_MIN_TRIPS) return false;
  const counts = lensCounts(trips, now);
  return (['upcoming', 'planning', 'past'] as const).filter((lens) => counts[lens] > 0).length >= 2;
}
