'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { fetchTrip, TripApiError, type Trip } from '@/lib/trips/api';
import { tripEditorialSubject } from '@/lib/trips/summary';

export type TripLoadStatus = 'error' | 'loading' | 'missing' | 'ready';

type TripContextValue = {
  /** The photograph the trip's cover falls back to, or null while unresolved. */
  editorial: EditorialImageReference | null;
  refresh: () => void;
  /** Writes back a trip the traveller just saved, without a second round trip. */
  setTrip: (trip: Trip) => void;
  status: TripLoadStatus;
  trip: Trip | null;
  tripId: string;
};

const TripContext = createContext<TripContextValue | null>(null);

/**
 * The trip, fetched once for everything inside `/trips/[tripId]`.
 *
 * Before this, every screen in a trip fetched the trip again — and so did the
 * header sitting on top of that screen, a second time, only after the screen's
 * own data had already landed. That second answer is what inserted the cover
 * mid-page and pushed the traveller's plan down the screen.
 *
 * A layout does not unmount when its children change, so the trip stays warm
 * across itinerary, memories and every supporting tool: the cover is fetched on
 * the way into a trip and never again while the traveller is inside it.
 */
export function TripProvider({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [status, setStatus] = useState<TripLoadStatus>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setTrip(null);
    setStatus('loading');

    void fetchTrip(tripId)
      .then(({ trip: result }) => {
        if (!active) return;
        setTrip(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A trip that is gone is a different answer from a trip that would not
        // load, and only one of them is worth offering a retry for.
        setStatus(error instanceof TripApiError && error.status === 404 ? 'missing' : 'error');
      });

    return () => {
      active = false;
    };
  }, [reloadKey, tripId]);

  // One subject for the whole trip, and none at all once the traveller has
  // given the trip a cover of its own.
  const subject = trip ? tripEditorialSubject(trip) : null;
  const editorialImages = useEditorialImages(subject ? [subject] : []);
  const editorial = subject
    ? (editorialImages.get(editorialSubjectKey(subject))?.[0] ?? null)
    : null;

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);
  const replaceTrip = useCallback((saved: Trip) => {
    setTrip(saved);
    setStatus('ready');
  }, []);

  const value = useMemo<TripContextValue>(
    () => ({ editorial, refresh, setTrip: replaceTrip, status, trip, tripId }),
    [editorial, refresh, replaceTrip, status, trip, tripId],
  );

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

/**
 * The trip for the screen the traveller is on. Returns null outside a trip, so
 * a shared component can be rendered on a non-trip surface without exploding.
 */
export function useTripContext() {
  return useContext(TripContext);
}
