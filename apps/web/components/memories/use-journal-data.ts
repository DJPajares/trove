'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useTripContext } from '@/components/trip-provider';
import { fetchItinerary } from '@/lib/itinerary/api';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { fetchMemories, type MemoryPhoto } from '@/lib/memories/api';
import { journalDays } from '@/lib/memories/journal';
import { locatedMemoryPlaces, routeSketch } from '@/lib/memories/route-sketch';
import { shouldRefreshSignedMedia } from '@/lib/memories/signed-media';
import { buildTripStory } from '@/lib/memories/story';
import { queryKeys } from '@/lib/query/keys';

/** The box the route is drawn into; the SVG scales it to whatever width it is given. */
export const ROUTE_SKETCH_BOX = { height: 140, padding: 14, width: 360 } as const;

/** Safari decodes HEIC; other browsers get the file as taken and cannot. */
function canDecodeHeic() {
  return typeof navigator !== 'undefined'
    ? /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)
    : false;
}

/**
 * Everything the journal reads, from the owners that already hold it.
 *
 * The trip comes from the trip's own provider, and with it the editorial
 * photograph already resolved for its cover - the journal never asks for a
 * second one. The itinerary is the same entry the planner and Trip Mode read,
 * and it is what names each day and places each Memory on the drawn route.
 *
 * Memories refetch whenever the journal opens. Trove turns refetch-on-mount off
 * everywhere, and an invalidation only reaches a query someone is watching, so
 * without this a Memory captured in Trip Mode would wait for a reload to
 * appear here. The endpoint costs a database read and a URL signature, never a
 * provider request.
 */
export function useJournalData(tripId: string) {
  const queryClient = useQueryClient();
  const tripContext = useTripContext();
  const trip = tripContext?.trip ?? null;

  const memoriesQuery = useQuery({
    queryFn: () => fetchMemories(tripId),
    queryKey: queryKeys.memories(tripId),
    refetchOnMount: true,
  });
  const itinerary =
    useQuery({ queryFn: () => fetchItinerary(tripId), queryKey: queryKeys.itinerary(tripId) })
      .data ?? null;

  const data = memoriesQuery.data ?? null;
  const story = useMemo(
    () => (data ? buildTripStory(data.memories, data.dayExperiences ?? []) : null),
    [data],
  );

  // One reading of the clock per visit: "today" does not change under a reader.
  const [now] = useState(() => new Date());
  const days = useMemo(
    () => (trip ? journalDays(trip, itinerary, now) : []),
    [itinerary, now, trip],
  );

  const sketch = useMemo(() => {
    if (!story || !itinerary) return null;
    const ordered = story.days.flatMap((day) => day.memories);
    return routeSketch(locatedMemoryPlaces(ordered, itinerary.tripPlaces), ROUTE_SKETCH_BOX);
  }, [itinerary, story]);

  const cover = resolveTripMediaSource({
    coverUrl: trip?.coverPhotoUrl,
    editorial: tripContext?.editorial,
    memoryUrl: data?.storyCover?.url,
    preferMemory: true,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.memories(tripId) }),
    [queryClient, tripId],
  );

  const lastRefreshAt = useRef<number | null>(null);
  /**
   * A photo that would not load. Its link has most likely expired, and the
   * service worker may be holding the failed answer under the photo's storage
   * path, which outlives every new signature - so that entry goes first, then
   * the Memories are asked for again, fresh links and all.
   */
  const reportPhotoError = useCallback(
    (photo: Pick<MemoryPhoto, 'contentType' | 'url'>) => {
      const now = Date.now();
      if (
        !shouldRefreshSignedMedia({
          canDecodeHeic: canDecodeHeic(),
          contentType: photo.contentType,
          lastRefreshAt: lastRefreshAt.current,
          now,
          online: typeof navigator === 'undefined' ? true : navigator.onLine,
          url: photo.url,
        })
      ) {
        return;
      }
      lastRefreshAt.current = now;
      void forgetCachedMediaUrls([photo.url]).finally(() => void refresh());
    },
    [refresh],
  );

  return {
    cover,
    data,
    days,
    itinerary,
    memoriesError: memoriesQuery.error,
    memoriesPending: memoriesQuery.isPending,
    refresh,
    reportPhotoError,
    sketch,
    story,
    trip,
    tripContext,
  };
}
