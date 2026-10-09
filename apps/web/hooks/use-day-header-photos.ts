'use client';

import { useState } from 'react';

import { useTripContext } from '@/components/trip-provider';
import type { ItineraryDay, ItineraryTripPlace } from '@/lib/itinerary/api';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import {
  dayHeaderPhotoSources,
  dayPhotoCandidates,
  settleDayHeaderPhotos,
  type DayHeaderPhotoResolution,
} from '@/lib/media/day-header-photos';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import type { TripMediaSource } from '@/lib/media/trip-media';

import { useEditorialImageResolution } from './use-editorial-images';

export function useDayHeaderPhotos(
  day: ItineraryDay | null,
  tripPlaces: readonly ItineraryTripPlace[],
) {
  const context = useTripContext();
  const candidates = dayPhotoCandidates(
    context?.status === 'loading' ? null : day,
    tripPlaces,
    context?.trip ?? null,
  );
  // Keep the full query identity stable while row photography comes into view.
  // The resolver already shares cached collections and overlapping in-flight work.
  const { images, isResolved } = useEditorialImageResolution(
    candidates.map((candidate) => candidate.subject),
  );
  const fallbackSources: TripMediaSource[] = (context?.dayFallbackImages ?? []).map(
    (reference) => ({ kind: 'editorial', reference }),
  );
  if (context?.trip?.coverPhotoUrl)
    fallbackSources.push({ kind: 'trip-cover', url: context.trip.coverPhotoUrl });
  if (context?.editorial) fallbackSources.push({ kind: 'editorial', reference: context.editorial });
  fallbackSources.push({ kind: 'local', src: dayHeaderFallback.src });
  const resolutionKey = JSON.stringify([
    context?.tripId,
    day?.id,
    candidates.map((candidate) => editorialSubjectKey(candidate.subject)),
    context?.dayFallbackResolutionKey,
  ]);
  const isResolving = !day || !isResolved || Boolean(context && !context.dayFallbackImagesResolved);
  const [previous, setPrevious] = useState<DayHeaderPhotoResolution | null>(null);
  const selection = settleDayHeaderPhotos(previous, {
    photos: dayHeaderPhotoSources(candidates, images, fallbackSources),
    isResolving,
    resolutionKey,
  });
  // Adjust during render so a changed day never commits the previous day's image.
  if (selection !== previous) setPrevious(selection);
  return selection;
}
