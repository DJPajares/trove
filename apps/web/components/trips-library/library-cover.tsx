'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';

import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { MediaFrame } from '@/components/media-frame';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { Button } from '@/components/ui/button';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { daysUntilTripStart, resolveCountdown } from '@/lib/trips/lifecycle';
import type { TripNextUp } from '@/lib/trips/next-up';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

const KICKER =
  'text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/85 uppercase';

/**
 * How far away a planned trip is, as one large number and the words it counts.
 * The number is the thing seen from across a room; the sentence beneath it is
 * the one a screen reader gets, whole.
 */
function Countdown({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.lead');
  const homeT = useTranslations('home');
  const countdown = resolveCountdown(daysUntilTripStart(trip));

  return (
    <p className="flex items-end gap-3">
      <span
        aria-hidden="true"
        className="text-[clamp(4.5rem,18vw,7.5rem)] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums"
      >
        {countdown.value}
      </span>
      <span
        aria-hidden="true"
        className="max-w-[7rem] pb-1 text-sm leading-tight font-medium text-white/85"
      >
        {t('countdownUnit', { count: countdown.value, unit: countdown.unit })}
      </span>
      <span className="sr-only">
        {homeT('countdown', { count: countdown.value, unit: countdown.unit })}
      </span>
    </p>
  );
}

function DayCount({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.lead');
  const { day, total } = tripDayProgress(trip);

  return (
    <div className="w-full max-w-sm space-y-3">
      <p className="flex items-end gap-2.5">
        <span aria-hidden="true" className={cn(KICKER, 'pb-2')}>
          {t('dayKicker')}
        </span>
        <span
          aria-hidden="true"
          className="text-[clamp(4.5rem,18vw,7.5rem)] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums"
        >
          {String(day).padStart(2, '0')}
        </span>
        <span aria-hidden="true" className="pb-1 text-sm font-medium text-white/85 tabular-nums">
          {t('dayOf', { total })}
        </span>
        <span className="sr-only">{t('dayProgress', { day, total })}</span>
      </p>
      <TripDaySegments day={day} total={total} />
    </div>
  );
}

/**
 * The line beneath the name: what the trip needs from the traveller now.
 *
 * Under way, that is the next stop - read from the Trip Mode context the
 * library already fetched for this one trip, never asked for again. Being
 * planned, it is how much of the trip has a plan, until the traveller calls the
 * plan Ready (PRD 9.2), after which it says nothing the badge does not.
 */
function StatusLine({ nextUp, trip }: Readonly<{ nextUp: TripNextUp | null; trip: Trip }>) {
  const t = useTranslations('trips.library.lead');

  if (trip.lifecycle === 'active') {
    if (!nextUp) return null;
    return (
      <p className="text-base leading-6 text-balance text-white/90">
        {nextUp.kind === 'nothingScheduled'
          ? t('nothingScheduled')
          : t(nextUp.kind === 'next' ? 'next' : 'current', { name: nextUp.label })}
      </p>
    );
  }

  if (trip.planningReadiness === 'ready' || !trip.itineraryCoverage) return null;

  return (
    <p className="text-sm font-medium text-white/85 tabular-nums">
      {t('planned', trip.itineraryCoverage)}
    </p>
  );
}

/**
 * Where the cover sits: across the whole viewport, cancelling the page's own
 * gutter and top padding, as Home's does. On a phone it runs under the status
 * area and the floating controls; from `md` under the header.
 */
const COVER_BLEED =
  'mx-[calc(50%-50vw)] -mt-[calc(var(--safe-top)+2rem)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)]';
/** Each slide holds the height, so a long name grows the cover rather than clipping. */
export const COVER_HEIGHT = 'min-h-[clamp(30rem,68svh,38rem)] md:min-h-[36rem] lg:min-h-[40rem]';
export const LIBRARY_COVER_FRAME = `${COVER_BLEED} ${COVER_HEIGHT}`;

/** The page's own measure inside the full-width photograph. */
const MEASURE =
  'mx-auto w-full max-w-[var(--layout-app)] ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)]';

const SCRIM =
  'absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.62)_0%,rgba(8,18,13,0.14)_26%,rgba(8,18,13,0.22)_44%,rgba(8,18,13,0.78)_70%,rgba(8,18,13,0.9)_100%)]';

const ENTER =
  'motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4';

export type LibraryCoverSlide = { editorial: EditorialImageReference | null; trip: Trip };

function CoverSlide({
  first,
  nextUp,
  slide: { editorial, trip },
}: Readonly<{
  first: boolean;
  nextUp: TripNextUp | null;
  slide: LibraryCoverSlide;
}>) {
  const t = useTranslations('trips.library.lead');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const subject = tripDestinationSummary(trip) ?? trip.name;
  const active = trip.lifecycle === 'active';

  return (
    <li
      aria-roledescription="slide"
      className={cn(
        'relative isolate flex w-full shrink-0 snap-start snap-always flex-col justify-end overflow-hidden',
        COVER_HEIGHT,
      )}
      data-slot="library-cover-slide"
    >
      <TripMedia
        alt={editorial ? mediaT('alt.tripEditorial', { name: subject }) : ''}
        className={cn(
          'absolute inset-0 -z-20 h-full w-full rounded-none',
          first &&
            'motion-safe:animate-in motion-safe:duration-[1400ms] motion-safe:ease-out motion-safe:zoom-in-105',
        )}
        preload={first}
        sizes="100vw"
        source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
        variant="cover"
      />
      {/* Fixed in both themes: dark at the top for the controls, nearly clear
          through the middle, then deep under the copy. */}
      <div aria-hidden="true" className={SCRIM} />

      <div className={MEASURE}>
        <div
          className={cn(
            'mx-auto w-full max-w-5xl space-y-5 pt-[calc(var(--safe-top)+5rem)] pb-24 md:pt-[calc(var(--safe-top)+var(--header-height)+3rem)] md:pb-28',
            first && ENTER,
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className={cn(KICKER, 'inline-flex items-center gap-2')}>
              {active ? (
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary-on-media/70 motion-reduce:animate-none" />
                  <span className="relative size-2 rounded-full bg-primary-on-media" />
                </span>
              ) : null}
              {t(active ? 'kickerActive' : first ? 'kickerPlanning' : 'kickerLater')}
            </p>
            <TripReadinessBadge
              lifecycle={trip.lifecycle}
              readiness={trip.planningReadiness}
              tone="onMedia"
            />
          </div>

          {active ? <DayCount trip={trip} /> : <Countdown trip={trip} />}

          <div className="space-y-2">
            {trip.countries?.length ? (
              <TripCountries className={cn(KICKER, 'block')} countries={trip.countries} />
            ) : null}
            <h2 className="max-w-[18ch] text-[length:var(--text-page-title)] leading-[1.04] font-semibold tracking-[-0.035em] text-balance [overflow-wrap:anywhere] md:text-[length:var(--text-immersive-title)] md:leading-[1]">
              {/* The name is the link, stretched over the whole slide, so the
                  photograph opens the trip while the heading stays a heading. */}
              <Link
                className="rounded-[var(--radius-sm)] outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-white/60"
                href={`/trips/${trip.id}`}
              >
                {trip.name}
              </Link>
            </h2>
            <p className="text-sm font-medium text-white/85 tabular-nums">
              {formatTripDateRange(trip.startDate, trip.endDate, locale)}
            </p>
          </div>

          <StatusLine nextUp={nextUp} trip={trip} />
        </div>
      </div>
    </li>
  );
}

export type LibraryCoverProps = {
  /** Said on the artwork when there is no trip to lead with. */
  description: string;
  /** The slide in view; the page's actions follow it. */
  index: number;
  /** What is next today, for a lead trip under way. */
  nextUp: TripNextUp | null;
  onIndexChange: (index: number) => void;
  /** The trip under way or next, then the trips after it, in departure order. */
  slides: LibraryCoverSlide[];
  /** The page's name. */
  title: string;
};

/**
 * The library's cover: the trip the traveller is on or leaving for next, edge
 * to edge, with the trips after it one swipe away. The countdown or the day
 * under way is the largest thing on each, because "how long until" and "how
 * far in" are what a traveller comes to this screen to feel.
 *
 * It is a native scroll-snap row, so a swipe, a trackpad and the keyboard all
 * move it without script; the dots and arrows only scroll it. With no trip to
 * lead with it is Trove's bundled artwork and the page's own name.
 */
export function LibraryCover({
  description,
  index,
  nextUp,
  onIndexChange,
  slides,
  title,
}: Readonly<LibraryCoverProps>) {
  const t = useTranslations('trips.library.cover');
  const reduced = useReducedMotion();
  const track = useRef<HTMLOListElement | null>(null);
  const count = slides.length;
  useCoverUnderHeader();

  if (count === 0) {
    return (
      <section
        aria-labelledby="trips-heading"
        className={cn(
          'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
          LIBRARY_COVER_FRAME,
        )}
        data-slot="library-cover"
      >
        <MediaFrame
          alt=""
          className="absolute inset-0 -z-20 h-full w-full rounded-none"
          dataSlot="library-cover-artwork"
          photographicPlaceholder={dayHeaderFallback.preview}
          preload
          sizes="100vw"
          source={{ kind: 'local', src: dayHeaderFallback.src }}
          variant="card"
        />
        <div aria-hidden="true" className={SCRIM} />
        <div className={MEASURE}>
          <div className="mx-auto w-full max-w-5xl space-y-3 pt-[calc(var(--safe-top)+5rem)] pb-16 md:pb-24">
            <h1
              className="font-journal text-[clamp(3rem,12vw,5rem)] leading-[0.95] font-normal tracking-[-0.01em]"
              id="trips-heading"
            >
              {title}
            </h1>
            <p className="max-w-md text-base leading-[1.55] text-pretty text-white/90">
              {description}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const go = (next: number) => {
    const slide = track.current?.children[next];
    if (!(slide instanceof HTMLElement)) return;
    track.current?.scrollTo({ behavior: reduced ? 'auto' : 'smooth', left: slide.offsetLeft });
  };

  return (
    <section
      aria-labelledby="trips-heading"
      aria-roledescription="carousel"
      className={cn('relative isolate bg-surface-media text-white', COVER_BLEED)}
      data-slot="library-cover"
    >
      {/* On a phone the page names itself where Home shows the weather; from
          `md` the header's own "Trips" does, so the heading is read, not seen. */}
      <h1
        className="absolute start-[var(--gutter-inline-start)] top-[calc(var(--safe-top)+0.75rem)] z-20 flex h-11 items-center text-base font-semibold tracking-[-0.01em] md:sr-only"
        id="trips-heading"
      >
        {title}
      </h1>

      <ol
        aria-label={t('label')}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const { clientWidth, scrollLeft } = event.currentTarget;
          const next = Math.round(Math.abs(scrollLeft) / clientWidth);
          if (next !== index && next < count) onIndexChange(next);
        }}
        ref={track}
      >
        {slides.map((slide, position) => (
          <CoverSlide
            first={position === 0}
            key={slide.trip.id}
            nextUp={position === 0 ? nextUp : null}
            slide={slide}
          />
        ))}
      </ol>

      {count > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-11 z-20 md:bottom-14">
          <div className={MEASURE}>
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
              <div className="pointer-events-auto flex items-center">
                {slides.map(({ trip }, position) => (
                  <button
                    aria-current={position === index ? 'true' : undefined}
                    aria-label={trip.name}
                    className="grid h-8 min-w-5 place-items-center rounded-full px-1 outline-none focus-visible:ring-3 focus-visible:ring-white/70"
                    key={trip.id}
                    onClick={() => go(position)}
                    type="button"
                  >
                    <span
                      className={cn(
                        'block h-1.5 rounded-full transition-[width,background-color] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                        position === index ? 'w-6 bg-white' : 'w-1.5 bg-white/40',
                      )}
                    />
                  </button>
                ))}
              </div>
              <p aria-live="polite" className="text-xs font-medium text-white/80 tabular-nums">
                {t('position', { current: index + 1, total: count })}
              </p>
              <div className="pointer-events-auto hidden gap-2 md:flex">
                {(
                  [
                    ['previous', index - 1, ChevronLeft],
                    ['next', index + 1, ChevronRight],
                  ] as const
                ).map(([key, target, Icon]) => (
                  <Button
                    aria-label={t(key)}
                    className="rounded-full border-white/20 bg-black/30 text-white backdrop-blur-md hover:bg-black/45 hover:text-white focus-visible:ring-white/70 rtl:rotate-180"
                    disabled={target < 0 || target >= count}
                    key={key}
                    onClick={() => go(target)}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
