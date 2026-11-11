'use client';

import type { TripOverviewDay } from '@trove/types';

import { MediaFrame } from '@/components/media-frame';
import { journeyStopSubject } from '@/components/trip-hub/trip-hub-journey';
import { useEditorialImageResolution } from '@/hooks/use-editorial-images';
import { editorialSubjectKey, primaryEditorialImage } from '@/lib/media/editorial-images';
import type { Trip } from '@/lib/trips/api';
import { tripJourneyStops } from '@/lib/trips/journey';

/**
 * Where the traveller is today, set down like a print: the editorial
 * photograph of today's town, the same one the journey shows beside it. It asks
 * for exactly the journey's subjects so the two share one resolution, and it is
 * decorative - with no photograph there is simply no postcard.
 */
export function TodayPostcard({
  dayId,
  days,
  trip,
}: Readonly<{ dayId: string; days: readonly TripOverviewDay[]; trip: Trip }>) {
  const stops = tripJourneyStops(days);
  const subjects = stops.map((stop) => journeyStopSubject(stop.town, trip));
  const { images } = useEditorialImageResolution(subjects);
  const index = stops.findIndex((stop) => stop.days.some((day) => day.id === dayId));
  const subject = subjects[index];
  const reference = subject
    ? primaryEditorialImage(images.get(editorialSubjectKey(subject)))
    : undefined;
  if (!reference) return null;

  return (
    <span
      aria-hidden="true"
      className="mt-1 mr-1 block w-24 shrink-0 rotate-3 bg-paper-print p-1.5 pb-5 shadow-[var(--shadow-print)] motion-safe:animate-in motion-safe:duration-[var(--motion-slow)] motion-safe:ease-[var(--ease-standard)] motion-safe:slide-in-from-top-3 motion-safe:-spin-in-6"
      data-slot="trip-hub-postcard"
    >
      <MediaFrame
        alt=""
        className="aspect-[4/5] rounded-[1px]"
        dataSlot="trip-hub-postcard-photo"
        sizes="96px"
        source={{ kind: 'editorial', reference }}
        variant="thumbnail"
      />
    </span>
  );
}
