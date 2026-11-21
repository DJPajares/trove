import type { PublicTravellerTrip } from '@/lib/public-trip/api';
import { isKnownCountry } from '@/lib/trips/countries';
import { calendarDayDistance } from '@/lib/trips/lifecycle';

export type PublicTravelSummary = {
  countries: number;
  daysAway: number;
  firstYear: number | null;
  trips: number;
};

export function publicTripDayCount(trip: Pick<PublicTravellerTrip, 'endDate' | 'startDate'>) {
  return calendarDayDistance(trip.startDate, trip.endDate) + 1;
}

/**
 * A traveller's travels in numbers, as strangers may see them (PRD 8.3).
 *
 * Counted from their listed Public trips and nothing else: a total that took in
 * Private trips would say how many of those there are. As on the owner's own
 * profile, only trips that have ended count - a plan is not a place someone has
 * been. `today` is a date-only string, passed in so the page agrees with itself.
 */
export function summarizePublicTravels(
  trips: readonly PublicTravellerTrip[],
  today: string,
): PublicTravelSummary {
  const completed = trips.filter((trip) => trip.endDate < today);
  const countries = new Set(completed.flatMap((trip) => trip.countries.filter(isKnownCountry)));

  return {
    countries: countries.size,
    daysAway: completed.reduce((total, trip) => total + publicTripDayCount(trip), 0),
    firstYear: completed.length
      ? Math.min(...completed.map((trip) => Number(trip.startDate.slice(0, 4))))
      : null,
    trips: completed.length,
  };
}
