import { normalizeItineraryPlaceQuery } from '@/lib/itinerary/item-editor';
import type { ProviderSearchResult } from '@/lib/saved/api';

/**
 * Autocomplete is billed per request unless the requests share a session token
 * and end in one Place Details call, which bills the whole run once. A picker is
 * that run: every search made while it is open shares a token, and choosing a
 * place (or closing the picker) ends it.
 */

/** Below this a search is mostly noise and would buy a request per keystroke. */
export const MIN_PROVIDER_SEARCH_LENGTH = 3;

/** The furthest Google allows a bias circle to reach. */
const LOCATION_BIAS_RADIUS_METERS = 50_000;

export type ProviderSearchLocationBias = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/** The text worth searching for, or null while it is too short to be worth a request. */
export function searchableProviderQuery(input: string): string | null {
  const query = input.trim();
  return query.length >= MIN_PROVIDER_SEARCH_LENGTH ? query : null;
}

/**
 * Where to prefer results: around the trip's first destination Trove has
 * coordinates for. Nothing is invented for a destination with no known location.
 */
export function destinationLocationBias(
  destinations: readonly { location?: { latitude: number; longitude: number } | null }[],
): ProviderSearchLocationBias | null {
  const located = destinations.find((destination) => destination.location);
  return located?.location
    ? {
        latitude: located.location.latitude,
        longitude: located.location.longitude,
        radiusMeters: LOCATION_BIAS_RADIUS_METERS,
      }
    : null;
}

export type ProviderSearchSession = ReturnType<typeof createProviderSearchSession>;

export function createProviderSearchSession(newToken: () => string = () => crypto.randomUUID()) {
  let token: string | null = null;
  const answers = new Map<string, ProviderSearchResult>();

  return {
    /** What this session has already been told for a query, so asking again is free. */
    cached(query: string) {
      return answers.get(normalizeItineraryPlaceQuery(query));
    },
    /** Starts the next session: a new token, and nothing remembered. */
    end() {
      token = null;
      answers.clear();
    },
    /** The token if a search has started one. Resolving never mints its own. */
    peekToken() {
      return token ?? undefined;
    },
    /** Only real answers are kept; an outage should be tried again, not replayed. */
    remember(query: string, result: ProviderSearchResult) {
      if (result.status === 'unavailable') return;
      answers.set(normalizeItineraryPlaceQuery(query), result);
    },
    /** The token every search in this session carries. */
    token() {
      token ??= newToken();
      return token;
    },
  };
}
