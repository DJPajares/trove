import { COUNTRY_CENTRES } from '@/lib/profile/country-centres';
import type { CountryStamp, VisitedPlace } from '@/lib/profile/travel-summary';
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

/**
 * Where a traveller has been, as strangers may see it (PRD 8.3): one point per
 * country of their ended, listed Public trips, at that country's centre, and a
 * stamp for each. Each listed trip already names its countries, so the map
 * says nothing the list does not - no destination, Place or coordinate of
 * theirs is used.
 */
export function publicTravelMap(
  trips: readonly PublicTravellerTrip[],
  today: string,
): { places: VisitedPlace[]; stamps: CountryStamp[] } {
  const stamps = new Map<string, CountryStamp>();
  const places = new Map<string, VisitedPlace>();
  const ended = trips
    .filter((trip) => trip.endDate < today)
    .toSorted((left, right) => left.startDate.localeCompare(right.startDate));

  for (const trip of ended) {
    const year = Number(trip.startDate.slice(0, 4));
    for (const code of new Set(trip.countries.filter(isKnownCountry))) {
      const stamp = stamps.get(code);
      stamps.set(
        code,
        stamp
          ? { ...stamp, firstYear: Math.min(stamp.firstYear, year), trips: stamp.trips + 1 }
          : { code, firstYear: year, trips: 1 },
      );
      const centre = COUNTRY_CENTRES[code];
      const key = `country:${code}`;
      if (centre && !places.has(key)) {
        places.set(key, {
          countryCode: code,
          key,
          latitude: centre[0],
          longitude: centre[1],
          name: code,
        });
      }
    }
  }

  return { places: [...places.values()], stamps: [...stamps.values()] };
}
