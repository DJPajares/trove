import type { Trip } from '@/lib/trips/api';
import { isKnownCountry } from '@/lib/trips/countries';
import { tripDayCount } from '@/lib/trips/facts';

export type CountryStamp = { code: string; firstYear: number; trips: number };
export type VisitedPlace = { latitude: number; longitude: number; name: string; placeId: string };

export type TravelSummary = {
  /** Completed, unarchived trips, most recent first. */
  completed: Trip[];
  /** Every country visited, in the order first visited. */
  countries: CountryStamp[];
  /** Distinct destinations across completed trips. */
  cities: number;
  daysAway: number;
  firstYear: number | null;
  /** Destinations with known coordinates, once each. */
  places: VisitedPlace[];
  /** Completed trips the traveller rated 4 or 5 that have Memory photos, best first. */
  favourites: Trip[];
};

const FAVOURITE_MIN_RATING = 4;

const year = (date: string) => Number(date.slice(0, 4));

/**
 * What a traveller's profile says about them, from the trips they have taken.
 *
 * Only completed trips count: a trip being planned is a plan, not a place
 * someone has been. Archived trips are left out here as everywhere else that
 * counts trips (PRD 6.3). Everything is derived from the trips list the app
 * already holds, so the profile costs no request of its own.
 */
export function summarizeTravels(trips: readonly Trip[]): TravelSummary {
  const completed = trips
    .filter((trip) => trip.lifecycle === 'completed' && !trip.archivedAt)
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));

  const countries = new Map<string, CountryStamp>();
  const cities = new Set<string>();
  const places = new Map<string, VisitedPlace>();
  let daysAway = 0;
  let firstYear: number | null = null;

  for (const trip of completed.toReversed()) {
    const started = year(trip.startDate);
    firstYear = firstYear === null ? started : Math.min(firstYear, started);
    daysAway += tripDayCount(trip);

    for (const code of new Set(trip.countries ?? [])) {
      if (!isKnownCountry(code)) continue;
      const known = countries.get(code);
      if (known) {
        known.trips += 1;
        known.firstYear = Math.min(known.firstYear, started);
      } else {
        countries.set(code, { code, firstYear: started, trips: 1 });
      }
    }

    for (const destination of trip.destinations) {
      cities.add(destination.placeId);
      if (destination.location && !places.has(destination.placeId)) {
        places.set(destination.placeId, {
          latitude: destination.location.latitude,
          longitude: destination.location.longitude,
          name: destination.name,
          placeId: destination.placeId,
        });
      }
    }
  }

  const favourites = completed
    .filter(
      (trip) =>
        (trip.experienceRating ?? 0) >= FAVOURITE_MIN_RATING && Boolean(trip.memoryPhotos?.length),
    )
    .toSorted(
      (left, right) =>
        (right.experienceRating ?? 0) - (left.experienceRating ?? 0) ||
        right.endDate.localeCompare(left.endDate),
    );

  return {
    cities: cities.size,
    completed,
    countries: [...countries.values()],
    daysAway,
    favourites,
    firstYear,
    places: [...places.values()],
  };
}
