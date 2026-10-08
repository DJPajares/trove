'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type CSSProperties } from 'react';

import { ExperienceRatingMark } from '@/components/experience-rating';
import { MediaFrame } from '@/components/media-frame';
import { Button } from '@/components/ui/button';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource, type TripMediaSource } from '@/lib/media/trip-media';
import { printTilts } from '@/lib/memories/photo-layout';
import { canDecodeHeic, isHeicContentType } from '@/lib/memories/signed-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { groupPastByYear } from '@/lib/trips/library';
import { PAST_TRIPS_PREVIEW_COUNT } from '@/lib/trips/lifecycle';
import { cn } from '@/lib/utils';

const KICKER =
  'text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-accent-strong uppercase';

/** The fewest older journeys worth folding behind a button. */
const MIN_FOLDED = 3;

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
function rememberedPrints(trip: Trip, editorial: EditorialImageReference | null) {
  const cover = resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial });
  const heic = canDecodeHeic();
  const photos = (trip.memoryPhotos ?? [])
    .filter((photo) => heic || !isHeicContentType(photo.contentType))
    .map((photo) => ({ kind: 'memory', url: photo.url }) satisfies TripMediaSource);

  return { cover, prints: photos.length ? photos : [cover] };
}

function monthYear(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/**
 * One photograph as a print, in the journal's own paper and lean, so a trip
 * looks on this shelf the way its story looks inside (PRD 31.2).
 */
function Print({
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
        dataSlot="library-print"
        fallbackSources={source === cover ? [] : [cover]}
        sizes={sizes}
        source={source}
        variant="card"
      />
    </span>
  );
}

/**
 * The most recent journey, told as the opening of its story: a small fan of
 * its own photographs, its name in the journal's serif, the traveller's own
 * words about it, and the way back in.
 */
function StoryFeature({
  editorial,
  trip,
}: Readonly<{ editorial: EditorialImageReference | null; trip: Trip }>) {
  const t = useTranslations('trips.library.remembered');
  const tripsT = useTranslations('trips');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const { cover, prints } = rememberedPrints(trip, editorial);
  const tilts = printTilts(trip.id, prints.length);
  // The fan is built back to front, so the first photograph - the story's own
  // cover - is the one laid on top.
  const positions = FAN_POSITIONS.slice(FAN_POSITIONS.length - prints.length);
  const line = trip.experienceNote?.trim() || trip.description?.trim() || null;

  return (
    <article
      aria-labelledby={`story-${trip.id}`}
      className="group grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12"
      data-slot="library-story"
    >
      <div aria-hidden="true" className="relative mx-auto aspect-[6/5] w-full max-w-[26rem]">
        {prints
          .map((source, index) => ({ index, source }))
          .toReversed()
          .map(({ index, source }, order) => (
            <Print
              className={cn(
                'absolute w-[58%] [@media(hover:hover)]:group-hover:rotate-[calc(var(--tilt)*1.6)]',
                prints.length === 1 ? 'start-[21%] top-[8%]' : positions[order],
              )}
              cover={cover}
              key={index}
              sizes="(max-width: 767px) 52vw, 15rem"
              source={source}
              style={{ '--tilt': `${(tilts[index] ?? 0) * 2.5}deg` } as CSSProperties}
            />
          ))}
      </div>

      <div className="min-w-0">
        <p className={cn(KICKER, 'tabular-nums')}>
          {monthYear(trip.startDate, locale)}
          <span aria-hidden="true"> · </span>
          {itineraryT('dayCount', { count: tripDayCount(trip) })}
        </p>
        <h3
          className="mt-3 font-journal text-[clamp(2.25rem,7vw,3.5rem)] leading-[0.95] font-normal tracking-[-0.01em] text-balance text-foreground [overflow-wrap:anywhere]"
          id={`story-${trip.id}`}
        >
          {trip.name}
        </h3>
        {line ? (
          <p className="mt-4 line-clamp-3 font-journal text-xl leading-[1.35] font-normal text-pretty text-muted-foreground italic">
            {line}
          </p>
        ) : null}
        <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground tabular-nums">
          {trip.memoryCount ? <span>{t('moments', { count: trip.memoryCount })}</span> : null}
          {trip.experienceRating === null ? null : (
            <ExperienceRatingMark
              rating={trip.experienceRating}
              wordClassName="font-journal text-base text-foreground italic"
            />
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href={`/trips/${trip.id}/memories`} />}>
            {trip.memoryCount ? t('openStory') : tripsT('addMemories')}
          </Button>
          <Button nativeButton={false} render={<Link href={`/trips/${trip.id}`} />} variant="ghost">
            {t('tripDetails')}
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * An older journey as a single print with its name written beneath, the way a
 * photograph is labelled in an album. It opens the trip's story directly: a
 * finished trip's first door is its Memories (PRD 4.5), and the journal's Exit
 * leads on to the rest of the trip.
 */
function Postcard({
  editorial,
  trip,
}: Readonly<{ editorial: EditorialImageReference | null; trip: Trip }>) {
  const t = useTranslations('trips.library.remembered');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const { cover, prints } = rememberedPrints(trip, editorial);
  const tilt = printTilts(trip.id, 1)[0] ?? 0;
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${trip.startDate}T00:00:00.000Z`),
  );

  return (
    <Link
      className="group block rounded-[var(--radius-md)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-4 focus-visible:ring-offset-paper"
      data-slot="library-postcard"
      href={`/trips/${trip.id}/memories`}
    >
      <Print
        className="[@media(hover:hover)]:group-hover:-translate-y-1 [@media(hover:hover)]:group-hover:rotate-[calc(var(--tilt)*0.3)]"
        cover={cover}
        sizes="(max-width: 639px) 44vw, (max-width: 1023px) 30vw, 14rem"
        source={prints[0] ?? cover}
        style={{ '--tilt': `${tilt}deg` } as CSSProperties}
      />
      <span className="mt-4 block px-1">
        <span className="line-clamp-2 font-journal text-xl leading-[1.1] font-normal text-balance text-foreground group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
          {trip.name}
        </span>
        <span className="mt-1.5 block text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
          {month}
          <span aria-hidden="true"> · </span>
          {trip.memoryCount
            ? t('moments', { count: trip.memoryCount })
            : itineraryT('dayCount', { count: tripDayCount(trip) })}
        </span>
      </span>
    </Link>
  );
}

export type LibraryRememberedProps = {
  editorialFor: (trip: Trip) => EditorialImageReference | null;
  /** Finished trips, most recent first. Empty shows where they will gather. */
  trips: Trip[];
};

/**
 * Where finished journeys are kept, in the Memories journal's own voice: its
 * paper, its serif, its prints. The shift is the point - a trip ahead is a plan
 * and reads in Trove's working sans; a trip taken is a story, and reads like
 * the one it opens into.
 *
 * The most recent journey leads as a story; the rest are an album by year,
 * the first few showing and the remainder one tap away.
 */
export function LibraryRemembered({ editorialFor, trips }: Readonly<LibraryRememberedProps>) {
  const t = useTranslations('trips.library.remembered');
  const [expanded, setExpanded] = useState(false);
  const [latest, ...older] = trips;
  // Folding away one or two prints saves less than the button that replaces
  // them costs, so the album only folds when it would hide a real handful.
  const preview = PAST_TRIPS_PREVIEW_COUNT - 1;
  const folds = older.length - preview >= MIN_FOLDED;
  const shown = folds && !expanded ? older.slice(0, preview) : older;
  const hiddenCount = older.length - shown.length;

  return (
    <section
      aria-labelledby="library-remembered-heading"
      className="-ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] bg-paper ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] pt-10 pb-12 md:mx-0 md:rounded-[var(--radius-2xl)] md:px-10 md:pt-12"
      data-slot="library-remembered"
    >
      <h2
        className="font-journal text-[clamp(2.25rem,6vw,3rem)] leading-none font-normal tracking-[-0.01em] text-foreground"
        id="library-remembered-heading"
      >
        {t('title')}
      </h2>

      {latest ? (
        <div className="mt-8 space-y-14">
          <StoryFeature editorial={editorialFor(latest)} trip={latest} />

          {shown.length ? (
            <div className="space-y-10">
              {groupPastByYear(shown).map((group) => (
                <section
                  aria-labelledby={`remembered-${group.year}`}
                  className="space-y-6"
                  key={group.year}
                >
                  <h3
                    className="flex items-center gap-4 font-journal text-[1.75rem] leading-none font-normal text-foreground tabular-nums"
                    id={`remembered-${group.year}`}
                  >
                    {group.year}
                    <span aria-hidden="true" className="h-px flex-1 bg-paper-rule" />
                  </h3>
                  <ul className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
                    {group.trips.map((trip) => (
                      <li key={trip.id}>
                        <Postcard editorial={editorialFor(trip)} trip={trip} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : null}

          {folds ? (
            <Button
              aria-expanded={expanded}
              className="group"
              onClick={() => setExpanded((value) => !value)}
              variant="outline"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'transition-transform duration-[var(--motion-standard)] motion-reduce:transition-none',
                  expanded && 'rotate-180',
                )}
                data-icon="inline-start"
              />
              {expanded ? t('showFewer') : t('showMore', { count: hiddenCount })}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-8 flex items-center gap-6">
          <span
            aria-hidden="true"
            className="block w-24 shrink-0 -rotate-3 rounded-[3px] border border-dashed border-paper-rule bg-paper-print/60 p-2 pb-5 sm:w-28"
          >
            <span className="block aspect-[4/5] rounded-[1px] bg-paper-rule/60" />
          </span>
          <div className="min-w-0 max-w-sm">
            <p className="font-journal text-2xl leading-tight text-foreground">{t('emptyTitle')}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('emptyDescription')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
