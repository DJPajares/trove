'use client';

import { useTripContext } from '@/components/trip-provider';
import type { ItineraryDay, ItineraryTripPlace } from '@/lib/itinerary/api';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import { dayHeaderPhotoSources, dayPhotoCandidates } from '@/lib/media/day-header-photos';
import { editorialSubjectKey, type EditorialImageReference } from '@/lib/media/editorial-images';
import type { TripMediaSource } from '@/lib/media/trip-media';

import { useEditorialImages } from './use-editorial-images';

export function useDayHeaderPhotos(
  day: ItineraryDay | null,
  tripPlaces: readonly ItineraryTripPlace[],
  existingImages?: ReadonlyMap<string, EditorialImageReference[]>,
) {
  const context = useTripContext();
  const candidates = dayPhotoCandidates(day, tripPlaces, context?.trip ?? null);
  const images = useEditorialImages(
    candidates
      .map((candidate) => candidate.subject)
      .filter((subject) => !existingImages?.has(editorialSubjectKey(subject))),
  );
  const allImages = new Map([...images, ...(existingImages ?? [])]);
  const fallbackSources: TripMediaSource[] = (context?.dayFallbackImages ?? []).map(
    (reference) => ({ kind: 'editorial', reference }),
  );
  if (context?.trip?.coverPhotoUrl)
    fallbackSources.push({ kind: 'trip-cover', url: context.trip.coverPhotoUrl });
  if (context?.editorial) fallbackSources.push({ kind: 'editorial', reference: context.editorial });
  fallbackSources.push({ kind: 'local', src: dayHeaderFallback.src });
  return dayHeaderPhotoSources(candidates, allImages, fallbackSources);
}
