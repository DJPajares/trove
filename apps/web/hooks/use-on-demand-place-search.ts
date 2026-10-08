'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeItineraryPlaceQuery } from '@/lib/itinerary/item-editor';
import { searchProviderPlaces, type ProviderSuggestion } from '@/lib/saved/api';
import type { ProviderSearchLocationBias } from '@/lib/saved/provider-search-session';

type SearchEntry = {
  sessionToken: string | null;
  status: 'empty' | 'loading' | 'ok' | 'unavailable';
  suggestions: ProviderSuggestion[];
};

export type OnDemandSearchStatus = 'idle' | 'loading' | 'unavailable';

/** Fewer characters than this is not yet a place worth asking Google about. */
export const ON_DEMAND_SEARCH_MINIMUM = 3;

/**
 * Google place search that runs only when the traveller asks for it.
 *
 * A stop's picker answers most of what is typed from the trip's own Places, so
 * searching as they type would buy autocomplete for text the trip already
 * knows - and an autocomplete request is billed when no place is picked. Here a
 * search is one explicit "Search Google for …", its answer is kept per query so
 * typing back to it costs nothing, and a newer search abandons the older one.
 * The session token from the answer goes with the place the traveller picks, so
 * search and resolve are one billed session. `locationBias` - where the day
 * already is - is a hint in the same request, so "the market" finds the one in
 * town rather than the best-known one anywhere.
 */
export function useOnDemandPlaceSearch(
  online: boolean,
  locationBias: ProviderSearchLocationBias | null = null,
) {
  const [results, setResults] = useState<ProviderSuggestion[]>([]);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<OnDemandSearchStatus>('idle');
  const cache = useRef(new Map<string, SearchEntry>());
  const inFlight = useRef<{ controller: AbortController; key: string } | null>(null);
  const currentKey = useRef('');

  useEffect(() => () => inFlight.current?.controller.abort(), []);

  const show = useCallback((entry: SearchEntry | undefined) => {
    setResults(entry?.suggestions ?? []);
    setSessionToken(entry?.sessionToken ?? null);
    setStatus(
      entry?.status === 'unavailable'
        ? 'unavailable'
        : entry?.status === 'loading'
          ? 'loading'
          : 'idle',
    );
  }, []);

  /** Follows what is typed: an earlier answer for the same text comes back at once. */
  const track = useCallback(
    (query: string) => {
      currentKey.current = normalizeItineraryPlaceQuery(query);
      show(cache.current.get(currentKey.current));
    },
    [show],
  );

  async function search(query: string) {
    const trimmed = query.trim();
    const key = normalizeItineraryPlaceQuery(trimmed);
    if (!online || trimmed.length < ON_DEMAND_SEARCH_MINIMUM || cache.current.has(key)) return;

    // A newer question abandons the older one, which is remembered as having no
    // answer so typing back to it offers the search again rather than a spinner.
    if (inFlight.current) {
      inFlight.current.controller.abort();
      cache.current.set(inFlight.current.key, {
        sessionToken: null,
        status: 'unavailable',
        suggestions: [],
      });
    }
    const controller = new AbortController();
    inFlight.current = { controller, key };
    cache.current.set(key, { sessionToken: null, status: 'loading', suggestions: [] });
    setStatus('loading');

    let entry: SearchEntry;
    try {
      const result = await searchProviderPlaces(trimmed, {
        ...(locationBias ? { locationBias } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      entry = {
        sessionToken: result.sessionToken,
        status:
          result.status === 'ok' ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'empty',
        suggestions: result.status === 'ok' ? result.suggestions : [],
      };
    } catch {
      if (controller.signal.aborted) return;
      entry = { sessionToken: null, status: 'unavailable', suggestions: [] };
    } finally {
      if (inFlight.current?.controller === controller) inFlight.current = null;
    }
    cache.current.set(key, entry);
    // The traveller may have typed on while this was in flight.
    if (currentKey.current === key) show(entry);
  }

  /** Whether this text has already been asked about, answer or not. */
  const asked = useCallback(
    (query: string) => cache.current.has(normalizeItineraryPlaceQuery(query)),
    [],
  );

  return { asked, results, search, sessionToken, status, track };
}
