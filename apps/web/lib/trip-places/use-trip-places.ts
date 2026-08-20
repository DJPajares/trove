'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  fetchTripPlaces,
  removeTripPlace,
  TripPlaceApiError,
  type TripPlace,
  type TripPlacePriority,
  updateTripPlace,
} from './api';

export type TripPlacesStatus = 'error' | 'idle' | 'loading';

/** Carries its own values so the caller can render it without knowing the key. */
export type TripPlacesError = { key: string; values?: Record<string, number> };

/**
 * The trip's Place collection and the three ways it changes. Both the Places page
 * and the itinerary's Places drawer read from this, so a priority set in one is
 * the same collection the other is looking at rather than a second copy of it.
 *
 * Each Place arrives named and located: the API serves the snapshot Trove stored
 * when it was added, so opening this screen asks Google for nothing.
 */
export function useTripPlaces(tripId: string) {
  const [tripName, setTripName] = useState('');
  const [places, setPlaces] = useState<TripPlace[]>([]);
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

  return {
    clearError: useCallback(() => setError(null), []),
    error,
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
