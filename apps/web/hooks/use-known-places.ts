'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/keys';
import { fetchKnownPlaces, type KnownPlace } from '@/lib/saved/api';

/** Long enough that reopening a picker asks for nothing; short enough to see a new trip's places. */
const KNOWN_PLACES_STALE_MS = 10 * 60_000;
const EMPTY_KNOWN_PLACES: KnownPlace[] = [];

/**
 * Every Place the traveller has already reached for, for a picker to match
 * while they type. One database read, shared and persisted, so it answers at
 * once and offline; failing to load only means fewer local answers.
 */
export function useKnownPlaces() {
  return (
    useQuery({
      queryFn: fetchKnownPlaces,
      queryKey: queryKeys.knownPlaces(),
      staleTime: KNOWN_PLACES_STALE_MS,
    }).data?.places ?? EMPTY_KNOWN_PLACES
  );
}
