'use client';

import type { CSSProperties } from 'react';

import { MediaFrame } from '@/components/media-frame';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource, type TripMediaSource } from '@/lib/media/trip-media';
import { printTilts } from '@/lib/memories/photo-layout';
import { canDecodeHeic, isHeicContentType } from '@/lib/memories/signed-media';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

/** Where each print in a fan lies, front last so it paints on top. */
const FAN_POSITIONS = [
  'start-[3%] top-[12%] z-0',
  'end-[3%] top-[4%] z-10',
  'start-[22%] top-[16%] z-20',
] as const;

/**
 * The photographs a finished trip is remembered by: its own Memories when it
 * has decodable ones, otherwise the cover every other trip surface shows.
 *
 * A Memory photograph can outlive its hour-long link in a page left open, so
 * each one falls back to the cover rather than to an empty tile.
 */
export function journeyPrints(trip: Trip, editorial: EditorialImageReference | null) {
  const cover = resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial });
  const heic = canDecodeHeic();
  const photos = (trip.memoryPhotos ?? [])
    .filter((photo) => heic || !isHeicContentType(photo.contentType))
    .map((photo) => ({ kind: 'memory', url: photo.url }) satisfies TripMediaSource);

  return { cover, prints: photos.length ? photos : [cover] };
}

/**
 * One photograph as a print, in the Memories journal's own paper and lean, so
 * a finished trip looks wherever it is shown the way its story looks inside
 * (PRD 31.2).
 */
export function JourneyPrint({
  className,
  cover,
  sizes,
  source,
  style,
}: Readonly<{
  className?: string;
  cover: TripMediaSource;
  sizes: string;
  source: TripMediaSource;
  style?: CSSProperties;
}>) {
  return (
    <span
      className={cn(
        'block rotate-[var(--tilt)] rounded-[3px] bg-paper-print p-[clamp(0.35rem,1.4vw,0.6rem)] pb-[clamp(1.1rem,4vw,1.75rem)] shadow-[var(--shadow-print)] transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
        className,
      )}
      style={style}
    >
      <MediaFrame
        alt=""
        className="aspect-[4/5] rounded-[1px]"
        dataSlot="journey-print"
        fallbackSources={source === cover ? [] : [cover]}
        sizes={sizes}
        source={source}
        variant="card"
      />
    </span>
  );
}

/**
 * Up to three of a trip's prints laid down as a small fan, its story's own
 * cover on top. Decorative: whatever sits beside it names the trip. Inside a
 * `group`, the fan opens a little further under a pointer that can hover.
 */
export function JourneyPrintFan({
  className,
  editorial,
  sizes,
  trip,
}: Readonly<{
  className?: string;
  editorial: EditorialImageReference | null;
  sizes: string;
  trip: Trip;
}>) {
  const { cover, prints } = journeyPrints(trip, editorial);
  const tilts = printTilts(trip.id, prints.length);
  // Built back to front, so the first photograph is the one laid on top.
  const positions = FAN_POSITIONS.slice(FAN_POSITIONS.length - prints.length);

  return (
    <div
      aria-hidden="true"
      className={cn('relative mx-auto aspect-[6/5] w-full max-w-[26rem]', className)}
      data-slot="journey-print-fan"
    >
      {prints
        .map((source, index) => ({ index, source }))
        .toReversed()
        .map(({ index, source }, order) => (
          <JourneyPrint
            className={cn(
              'absolute w-[58%] [@media(hover:hover)]:group-hover:rotate-[calc(var(--tilt)*1.6)]',
              prints.length === 1 ? 'start-[21%] top-[8%]' : positions[order],
            )}
            cover={cover}
            key={index}
            sizes={sizes}
            source={source}
            style={{ '--tilt': `${(tilts[index] ?? 0) * 2.5}deg` } as CSSProperties}
          />
        ))}
    </div>
  );
}
