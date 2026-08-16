'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
  const [status, setStatus] = useState<TripPlacesStatus>('loading');
  const [error, setError] = useState<TripPlacesError | null>(null);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await fetchTripPlaces(tripId);
      setTripName(result.trip.name);
      setPlaces(result.tripPlaces);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Provider Places carry no name of their own; the current one is resolved on
  // demand and shared through the session cache with every other surface.
  useEffect(() => {
    const pending = places.filter(
      (entry) =>
        entry.place.kind === 'provider' &&
        providerDetails[entry.place.id] === undefined &&
        entry.place.providerRefs[0],
    );
    if (!pending.length) return;

    let active = true;
    void Promise.all(
      pending.map(async (entry) => {
        const providerId = entry.place.providerRefs[0]?.externalPlaceId;
        if (!providerId) return { details: null, id: entry.place.id };
        const cached = getCachedProviderPlaceDetails(entry.place.id);
        if (cached) return { details: cached, id: entry.place.id };
        try {
          const result = await getProviderPlaceDetails(providerId);
          const details = result.status === 'ok' ? (result.place ?? null) : null;
          if (details) cacheProviderPlaceDetails(entry.place.id, details);
          return { details, id: entry.place.id };
        } catch {
          return { details: null, id: entry.place.id };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.id, result.details])),
      }));
    });

    return () => {
      active = false;
    };
  }, [places, providerDetails]);

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

  const saveNote = useCallback(
    async (tripPlace: TripPlace, note: string) => {
      setError(null);
      try {
        replace((await updateTripPlace(tripId, tripPlace.id, { note: note || null })).tripPlace);
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
    error,
    places,
    providerDetails,
    refresh,
    remove,
    saveNote,
    setPlaces,
    setPriority,
    sorted,
    status,
    tripName,
  };
}
