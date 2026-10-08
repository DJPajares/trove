'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

import { useEditorialImageResolution } from '@/hooks/use-editorial-images';
import { tripSecondaryImages } from '@/lib/media/day-header-photos';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { apiErrorStatus } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrip, type Trip } from '@/lib/trips/api';
import { cacheSavedTrip } from '@/lib/trips/cache';
import { tripEditorialSubject, tripSecondaryEditorialSubject } from '@/lib/trips/summary';

export type TripLoadStatus = 'error' | 'loading' | 'missing' | 'ready';

const EMPTY_IMAGES: EditorialImageReference[] = [];

type TripContextValue = {
  /** The photograph the trip's cover falls back to, or null while unresolved. */
  editorial: EditorialImageReference | null;
  dayFallbackImages: EditorialImageReference[];
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
 * across the itinerary, Trip Mode, the Memories journal and every supporting
 * tool: the cover is fetched on the way into a trip and never again while the
 * traveller is inside it.
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

  // Resolve the secondary role even when the traveller supplied a cover.
  const subject = trip ? tripEditorialSubject(trip, { includeUploadedCover: true }) : null;
  const { images: editorialImages, isResolved } = useEditorialImageResolution(
    subject ? [subject] : [],
  );
  const collection = subject
    ? (editorialImages.get(editorialSubjectKey(subject)) ?? EMPTY_IMAGES)
    : EMPTY_IMAGES;
  const editorial = editorialCoverImage(collection, trip?.id ?? tripId);
  const secondary = tripSecondaryImages(collection, trip?.id ?? tripId);
  const supplementalSubject =
    trip && isResolved && secondary.length === 0 ? tripSecondaryEditorialSubject(trip) : null;
  const needsSupplement =
    supplementalSubject &&
    (!subject || editorialSubjectKey(supplementalSubject) !== editorialSubjectKey(subject));
  const { images: supplementalImages } = useEditorialImageResolution(
    needsSupplement ? [supplementalSubject] : [],
  );
  const supplemental = supplementalSubject
    ? (supplementalImages.get(editorialSubjectKey(supplementalSubject)) ?? EMPTY_IMAGES)
    : EMPTY_IMAGES;
  const dayFallbackImages = useMemo(
    () => tripSecondaryImages(collection, trip?.id ?? tripId, supplemental),
    [collection, supplemental, trip?.id, tripId],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
  }, [queryClient, tripId]);

  const replaceTrip = useCallback(
    (saved: Trip) => {
      cacheSavedTrip(queryClient, saved);
    },
    [queryClient],
  );

  const value = useMemo<TripContextValue>(
    () => ({ dayFallbackImages, editorial, refresh, setTrip: replaceTrip, status, trip, tripId }),
    [dayFallbackImages, editorial, refresh, replaceTrip, status, trip, tripId],
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
