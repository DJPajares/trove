'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  type ProviderPlaceDetails,
} from '@/lib/saved/api';

import {
  fetchTripPlaces,
  removeTripPlace,
  TripPlaceApiError,
  type TripPlace,
  type TripPlacePriority,
  updateTripPlace,
} from './api';

export type TripPlaceDetails = Record<string, ProviderPlaceDetails | null | undefined>;

/**
 * Which Places the provider could not answer for. Kept apart from the details
 * themselves so a failure is a thing that can be tried again rather than an
 * answer, and so the UI can offer to retry rather than silently showing nothing.
 */
export type TripPlaceDetailFailures = Record<string, 'empty' | 'unavailable' | undefined>;

export type TripPlacesStatus = 'error' | 'idle' | 'loading';

/** Carries its own values so the caller can render it without knowing the key. */
export type TripPlacesError = { key: string; values?: Record<string, number> };

function priorityRank(priority: TripPlacePriority | null) {
  return priority === 'must_go' ? 0 : priority === 'interested' ? 1 : priority === 'maybe' ? 2 : 3;
}

/**
 * The trip's Place collection and the three ways it changes. Both the Places page
 * and the itinerary's Places drawer read from this, so a priority set in one is
 * the same collection the other is looking at rather than a second copy of it.
 */
export function useTripPlaces(tripId: string) {
  const [tripName, setTripName] = useState('');
  const [places, setPlaces] = useState<TripPlace[]>([]);
  const [providerDetails, setProviderDetails] = useState<TripPlaceDetails>({});
  const [detailFailures, setDetailFailures] = useState<TripPlaceDetailFailures>({});
  const [status, setStatus] = useState<TripPlacesStatus>('loading');
  const [error, setError] = useState<TripPlacesError | null>(null);

  /**
   * Which Places have already been asked about. Held in a ref rather than inferred
   * from `providerDetails`, because inferring it made a single failed lookup
   * permanent: the entry stopped being undefined, so it was never asked again.
   */
  const attempted = useRef(new Set<string>());

  const retryProviderDetails = useCallback(() => {
    attempted.current.clear();
    setDetailFailures({});
    setProviderDetails((current) =>
      Object.fromEntries(Object.entries(current).filter(([, details]) => details)),
    );
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await fetchTripPlaces(tripId);
      setTripName(result.trip.name);
      setPlaces(result.tripPlaces);
      setStatus('idle');
      // Pulling the collection again is also a fresh chance at the names.
      retryProviderDetails();
    } catch {
      setStatus('error');
    }
  }, [retryProviderDetails, tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Provider Places carry no name of their own; the current one is resolved on
  // demand and shared through the session cache with every other surface.
  useEffect(() => {
    const pending = places.filter(
      (entry) =>
        entry.place.kind === 'provider' &&
        !attempted.current.has(entry.place.id) &&
        entry.place.providerRefs[0],
    );
    if (!pending.length) return;

    for (const entry of pending) attempted.current.add(entry.place.id);

    let active = true;
    void Promise.all(
      pending.map(async (entry) => {
        const id = entry.place.id;
        const providerId = entry.place.providerRefs[0]?.externalPlaceId;
        if (!providerId) return { details: null, failure: 'empty' as const, id };

        const cached = getCachedProviderPlaceDetails(id);
        if (cached) return { details: cached, failure: undefined, id };

        try {
          const result = await getProviderPlaceDetails(providerId);
          if (result.status !== 'ok') return { details: null, failure: result.status, id };
          const details = result.place ?? null;
          if (details) cacheProviderPlaceDetails(id, details);
          return { details, failure: details ? undefined : ('empty' as const), id };
        } catch {
          return { details: null, failure: 'unavailable' as const, id };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.id, result.details])),
      }));
      setDetailFailures((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.id, result.failure])),
      }));
    });

    return () => {
      active = false;
    };
  }, [places]);

  const replace = useCallback((tripPlace: TripPlace) => {
    setPlaces((current) => current.map((entry) => (entry.id === tripPlace.id ? tripPlace : entry)));
  }, []);

  const setPriority = useCallback(
    async (tripPlace: TripPlace, priority: TripPlacePriority | null) => {
      setError(null);
      try {
        replace((await updateTripPlace(tripId, tripPlace.id, { priority })).tripPlace);
      } catch {
        setError({ key: 'actionError' });
      }
    },
    [replace, tripId],
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
   * Removal is refused while the itinerary still schedules the Place. The caller
   * gets the reference count so it can say how many, rather than only that it failed.
   */
  const remove = useCallback(
    async (tripPlace: TripPlace) => {
      setError(null);
      try {
        await removeTripPlace(tripId, tripPlace.id);
        setPlaces((current) => current.filter((entry) => entry.id !== tripPlace.id));
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
    [tripId],
  );

  const sorted = useMemo(
    () =>
      places.toSorted(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          left.createdAt.localeCompare(right.createdAt),
      ),
    [places],
  );

  return {
    clearError: useCallback(() => setError(null), []),
    detailFailures,
    error,
    places,
    providerDetails,
    refresh,
    retryProviderDetails,
    remove,
    savePlace,
    setPlaces,
    setPriority,
    sorted,
    status,
    tripName,
  };
}
