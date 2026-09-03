'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { apiErrorStatus } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrip, type Trip } from '@/lib/trips/api';
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
 * the way into a trip and never again while the traveller is inside it. The
 * shared query key extends that past the layout - Trip Mode reads the same
 * entry rather than fetching the trip a third time.
 */
export function TripProvider({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery({
    queryFn: () => fetchTrip(tripId),
    queryKey: queryKeys.trip(tripId),
  });

  const trip = data?.trip ?? null;

  // A trip that is gone is a different answer from a trip that would not load,
  // and only one of them is worth offering a retry for.
  const status: TripLoadStatus = isPending
    ? 'loading'
    : error
      ? apiErrorStatus(error) === 404
        ? 'missing'
        : 'error'
      : 'ready';

  // One subject for the whole trip, and none at all once the traveller has
  // given the trip a cover of its own.
  const subject = trip ? tripEditorialSubject(trip) : null;
  const editorialImages = useEditorialImages(subject ? [subject] : []);
  const editorial = subject
    ? editorialCoverImage(editorialImages.get(editorialSubjectKey(subject)), trip?.id ?? tripId)
    : null;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
  }, [queryClient, tripId]);

  const replaceTrip = useCallback(
    (saved: Trip) => {
      queryClient.setQueryData(queryKeys.trip(tripId), { trip: saved });
    },
    [queryClient, tripId],
  );

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
