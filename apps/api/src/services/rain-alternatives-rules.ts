import { placeProfile } from './plan-score-place-types.js';
import { haversineKm } from './plan-score-route-comparison.js';

/**
 * Indoor places from the traveller's own list to put beside a stop that rain is
 * forecast for. Pure and suggestion-only: nothing is replanned, and the
 * traveller confirms any swap (PRD 29.4). This is not the weather-aware
 * replanning the PRD defers (35.6): it only lists options already chosen.
 */

type Coordinates = { latitude: number; longitude: number };

/** Further than this is a different part of town, not an alternative. */
export const MAX_ALTERNATIVE_KM = 5;
export const ALTERNATIVES_PER_STOP = 3;

export type IndoorCandidate = {
  coordinates: Coordinates | null;
  /** Shut on the day, from stored hours: never offered. */
  closedThatDay: boolean;
  hoursUnknown: boolean;
  rating: number | null;
  tripPlaceId: string;
  types: readonly string[];
};

export type IndoorAlternative = {
  distanceKm: number;
  hoursUnknown: boolean;
  rating: number | null;
  tripPlaceId: string;
};

/** A kind of place that is visited and is indoors. Unknown kinds are not assumed indoors. */
export function isIndoorVisit(types: readonly string[]) {
  const profile = placeProfile(types);
  return Boolean(profile && profile.kind === 'visit' && !profile.outdoor);
}

export function indoorAlternativesFor(
  stop: Coordinates | null,
  candidates: readonly IndoorCandidate[],
): IndoorAlternative[] {
  if (!stop) return [];
  return candidates
    .flatMap((candidate) => {
      if (!candidate.coordinates || candidate.closedThatDay || !isIndoorVisit(candidate.types))
        return [];
      const distanceKm = haversineKm(stop, candidate.coordinates);
      if (distanceKm > MAX_ALTERNATIVE_KM) return [];
      return [
        {
          // Lower is better: nearby first, unknown hours a little behind, good ratings a little ahead.
          score:
            distanceKm +
            (candidate.hoursUnknown ? 1 : 0) -
            (candidate.rating !== null ? (candidate.rating - 4) * 0.5 : 0),
          alternative: {
            distanceKm: Math.round(distanceKm * 10) / 10,
            hoursUnknown: candidate.hoursUnknown,
            rating: candidate.rating,
            tripPlaceId: candidate.tripPlaceId,
          },
        },
      ];
    })
    .toSorted((a, b) => a.score - b.score)
    .slice(0, ALTERNATIVES_PER_STOP)
    .map((entry) => entry.alternative);
}
