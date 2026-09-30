'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  searchProviderPlaces,
  type ProviderSearchResult,
  type ProviderSuggestion,
} from '@/lib/saved/api';
import {
  createProviderSearchSession,
  searchableProviderQuery,
  type ProviderSearchLocationBias,
  type ProviderSearchSession,
} from '@/lib/saved/provider-search-session';

export type ProviderPlaceSearchStatus = 'empty' | 'idle' | 'loading' | 'unavailable';

/**
 * Debounced Google Places search for a picker that searches as the traveller
 * types. All searches made while the picker is open share one session token
 * and a per-query answer cache, so typing costs one billed session rather than
 * a request per pause. Call `endSession` once a place has been chosen.
 */
export function useProviderPlaceSearch(
  query: string,
  locationBias: ProviderSearchLocationBias | null,
) {
  const sessionRef = useRef<ProviderSearchSession | null>(null);
  sessionRef.current ??= createProviderSearchSession();
  const session = sessionRef.current;

  const [results, setResults] = useState<ProviderSuggestion[]>([]);
  const [status, setStatus] = useState<ProviderPlaceSearchStatus>('idle');

  const searchable = searchableProviderQuery(query);
  const biasLatitude = locationBias?.latitude;
  const biasLongitude = locationBias?.longitude;
  const biasRadius = locationBias?.radiusMeters;

  useEffect(() => {
    if (!searchable) {
      setResults([]);
      setStatus('idle');
      return;
    }

    const apply = (result: ProviderSearchResult) => {
      if (result.status === 'unavailable') {
        setResults([]);
        setStatus('unavailable');
        return;
      }
      setResults(result.suggestions ?? []);
      setStatus(result.status === 'empty' ? 'empty' : 'idle');
    };

    const cached = session.cached(searchable);
    if (cached) {
      apply(cached);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setStatus('loading');
      void searchProviderPlaces(searchable, {
        locationBias:
          biasLatitude === undefined || biasLongitude === undefined || biasRadius === undefined
            ? undefined
            : { latitude: biasLatitude, longitude: biasLongitude, radiusMeters: biasRadius },
        sessionToken: session.token(),
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          session.remember(searchable, result);
          apply(result);
        })
        .catch((cause: unknown) => {
          if (
            controller.signal.aborted ||
            (cause instanceof DOMException && cause.name === 'AbortError')
          ) {
            return;
          }
          setResults([]);
          setStatus('unavailable');
        });
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [biasLatitude, biasLongitude, biasRadius, searchable, session]);

  // Closing the picker ends the session, so the next one is billed on its own.
  useEffect(() => () => session.end(), [session]);

  const endSession = useCallback(() => session.end(), [session]);
  const sessionToken = useCallback(() => session.peekToken(), [session]);

  return { endSession, results, searchable: searchable !== null, sessionToken, status };
}
