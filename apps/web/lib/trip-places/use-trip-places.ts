'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { queryKeys } from '@/lib/query/keys';
import { fetchItinerary, type Itinerary } from '@/lib/itinerary/api';
import { mergeItineraryTripPlace } from '@/lib/itinerary/places';
import {
  invalidateTripQueries,
  PLACE_LOCATION_QUERY_ROOTS,
  PLAN_SCORE_INPUT_QUERY_ROOTS,
} from '@/lib/query/trip-invalidation';

import {
  fetchTripPlaces,
  removeTripPlace,
  TripPlaceApiError,
  type TripPlace,
  type TripPlacePriority,
  type TripPlacesResponse,
  updateTripPlace,
} from './api';
import { setTripPlacePriority } from './priority';

export type TripPlacesStatus = 'error' | 'idle' | 'loading';

/** Carries its own values so the caller can render it without knowing the key. */
export type TripPlacesError = { key: string; values?: Record<string, number> };

/**
 * The trip's Place collection and the three ways it changes. Every contextual
 * drawer reads this shared cache, so all entry points see the same collection.
 *
 * Each Place arrives named and located: the API serves the snapshot Trove stored
 * when it was added, so opening this screen asks Google for nothing.
 */
export function useTripPlaces(tripId: string) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<TripPlacesError | null>(null);
  const queryKey = queryKeys.tripPlaces(tripId);

  const query = useQuery({ queryFn: () => fetchTripPlaces(tripId), queryKey });

  const places = query.data?.tripPlaces ?? [];
  const tripName = query.data?.trip.name ?? '';
  const status: TripPlacesStatus = query.isPending ? 'loading' : query.error ? 'error' : 'idle';

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, tripId]);

  /**
   * Writes an edited Place straight back into the cache. The server has already
   * confirmed it, so a refetch would only ask for what is now in hand - and the
   * drawer and itinerary both read shared entries, so both move
   * together without either re-fetching.
   */
  const setPlaces = useCallback(
    (update: (current: TripPlace[]) => TripPlace[]) => {
      queryClient.setQueryData(queryKey, (current: TripPlacesResponse | undefined) =>
        current ? { ...current, tripPlaces: update(current.tripPlaces) } : current,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [queryClient, tripId],
  );

  const replace = useCallback(
    (tripPlace: TripPlace) => {
      setPlaces((current) =>
        current.map((entry) => (entry.id === tripPlace.id ? tripPlace : entry)),
      );
      queryClient.setQueryData<Itinerary>(queryKeys.itinerary(tripId), (current) =>
        current ? mergeItineraryTripPlace(current, tripPlace) : current,
      );
    },
    [queryClient, setPlaces, tripId],
  );

  const setPriority = useCallback(
    async (tripPlace: TripPlace, priority: TripPlacePriority | null) => {
      setError(null);
      try {
        await setTripPlacePriority(queryClient, tripId, tripPlace.id, priority);
      } catch {
        setError({ key: 'actionError' });
      }
    },
    [queryClient, tripId],
  );

  /**
   * The name the traveller gave this Place on the trip and the note they kept with
   * it are edited together, so they travel to the server together as one change.
   */
  const savePlace = useCallback(
    async (tripPlace: TripPlace, input: { customName?: string | null; note?: string | null }) => {
      setError(null);
      try {
        replace((await updateTripPlace(tripId, tripPlace.id, input)).tripPlace);
        return true;
      } catch {
        setError({ key: 'actionError' });
        return false;
      }
    },
    [replace, tripId],
  );

  /**
   * A Place that has just been given coordinates for the first time.
   *
   * The Place row is shared, so this cannot be patched into one cache entry: the
   * pin, the day's legs, the forecast and the score were all computed as though
   * the place were nowhere, and three of those refetch on nothing but an
   * invalidation. Cheaper to re-ask than to reason about which of them noticed.
   */
  const placeLocated = useCallback(async () => {
    await invalidateTripQueries(queryClient, tripId, PLACE_LOCATION_QUERY_ROOTS);
  }, [queryClient, tripId]);

  /**
   * Removal is refused while the itinerary still schedules the Place. The caller
   * gets the reference count so it can say how many, rather than only that it failed.
   */
  const remove = useCallback(
    async (tripPlace: TripPlace) => {
      setError(null);
      try {
        await removeTripPlace(tripId, tripPlace.id);
        setPlaces((current) => current.filter((entry) => entry.id !== tripPlace.id));
        queryClient.setQueryData<Itinerary>(queryKeys.itinerary(tripId), (current) =>
          current
            ? {
                ...current,
                tripPlaces: current.tripPlaces.filter((entry) => entry.id !== tripPlace.id),
              }
            : current,
        );
        // Removal may also detach a daily base and re-resolve its timezone.
        // Reconcile those server-owned settings without acquiring provider data.
        void queryClient
          .fetchQuery({
            queryFn: () => fetchItinerary(tripId, { cachedOnly: true }),
            queryKey: queryKeys.itinerary(tripId),
            staleTime: 0,
          })
          .catch(() =>
            queryClient.invalidateQueries({
              queryKey: queryKeys.itinerary(tripId),
              refetchType: 'none',
            }),
          );
        // Removal is refused while the itinerary schedules the Place, so this can
        // only ever drop an unscheduled one - which is exactly the Must Go the
        // score was counting as unmet.
        await invalidateTripQueries(queryClient, tripId, PLAN_SCORE_INPUT_QUERY_ROOTS);
        return { ok: true as const };
      } catch (cause) {
        const referenced =
          cause instanceof TripPlaceApiError && cause.code === 'trip_place_referenced';
        const referenceCount = cause instanceof TripPlaceApiError ? (cause.referenceCount ?? 0) : 0;
        setError(
          referenced
            ? { key: 'referencedError', values: { count: referenceCount } }
            : { key: 'actionError' },
        );
        return { ok: false as const, referenceCount, referenced };
      }
    },
    [queryClient, setPlaces, tripId],
  );

  return {
    clearError: useCallback(() => setError(null), []),
    error,
    placeLocated,
    places,
    refresh,
    remove,
    savePlace,
    setPlaces,
    setPriority,
    status,
    tripName,
  };
}
