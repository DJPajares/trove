'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

/**
 * Across the whole viewport, cancelling the page's own gutter and top padding,
 * as the Home and Trips covers do: under the status area and the floating
 * controls on a phone, under the header from `md`.
 */
const COVER_BLEED =
  'mx-[calc(50%-50vw)] -mt-[calc(var(--safe-top)+2rem)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)]';
const COVER_HEIGHT = 'min-h-[clamp(28rem,62svh,36rem)] md:min-h-[34rem] lg:min-h-[36rem]';
/** The cover's place and size, for the skeleton that holds it while finds load. */
export const FINDS_COVER_FRAME = `${COVER_BLEED} ${COVER_HEIGHT}`;
const MEASURE =
  'mx-auto w-full max-w-[var(--layout-app)] ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)]';
const SCRIM =
  'absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.62)_0%,rgba(8,18,13,0.14)_26%,rgba(8,18,13,0.22)_44%,rgba(8,18,13,0.78)_70%,rgba(8,18,13,0.9)_100%)]';

export type FindsCoverTown = {
  count: number;
  editorial: EditorialImageReference | null;
  /** Where the town's group sits on the page, for Browse. */
  anchor: string;
  name: string;
  /** When its earliest find was kept, already formatted. */
  since: string;
};

/**
 * The top of Finds: one town at a time, the ones whose finds have waited
 * longest first, on its own photograph. It is a reminder with a next step, not
 * decoration - plan a trip, or browse what is kept there. With no town to name
 * it is Trove's bundled artwork and the page's own name.
 *
 * A native scroll-snap row, as the Trips cover is, so a swipe, a trackpad and
 * the keyboard all move it; the dots and arrows only scroll it.
 */
export function FindsCover({
  description,
  enter,
  onPlanTrip,
  title,
  total,
  towns,
}: Readonly<{
  description: string;
  /** The page's entrance, already decided for this mount. */
  enter: boolean;
  onPlanTrip: () => void;
  title: string;
  /** Every find, not only the towns on the cover. */
  total: number;
  towns: FindsCoverTown[];
}>) {
  const t = useTranslations('saved.cover');
  const reduced = useReducedMotion();
  const track = useRef<HTMLOListElement | null>(null);
  const [index, setIndex] = useState(0);
  useCoverUnderHeader();

  if (towns.length === 0) {
    return (
      <section
        aria-labelledby="finds-heading"
        className={cn(
          'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
          COVER_BLEED,
          COVER_HEIGHT,
        )}
        data-slot="finds-cover"
      >
        <MediaFrame
          alt=""
          className={cn(
            'absolute inset-0 -z-20 h-full w-full rounded-none',
            enter && pageEntrance.media,
          )}
          dataSlot="finds-cover-artwork"
          photographicPlaceholder={dayHeaderFallback.preview}
          preload
          sizes="100vw"
          source={{ kind: 'local', src: dayHeaderFallback.src }}
          variant="card"
        />
        <div aria-hidden="true" className={SCRIM} />
        <div className={MEASURE}>
          <div
            className={cn(
              'mx-auto w-full max-w-6xl space-y-3 pt-[calc(var(--safe-top)+5rem)] pb-16 md:pb-24',
              enter && pageEntrance.rise,
            )}
          >
            <h1
              className="font-journal text-[clamp(3rem,12vw,5rem)] leading-[0.95] font-normal tracking-[-0.01em]"
              id="finds-heading"
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
      aria-labelledby="finds-heading"
      aria-roledescription="carousel"
      className={cn('relative isolate bg-surface-media text-white', COVER_BLEED)}
      data-slot="finds-cover"
    >
      {/* On a phone the page names itself at the top, where Home shows the
          weather; from `md` the header's own "Finds" does. */}
      <h1
        className="absolute start-[var(--gutter-inline-start)] top-[calc(var(--safe-top)+0.75rem)] z-20 flex h-11 items-center text-base font-semibold tracking-[-0.01em] md:sr-only"
        id="finds-heading"
      >
        {title}
      </h1>

      <ol
        aria-label={t('label')}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const { clientWidth, scrollLeft } = event.currentTarget;
          const next = Math.round(Math.abs(scrollLeft) / clientWidth);
          if (next !== index && next < towns.length) setIndex(next);
        }}
        ref={track}
      >
        {towns.map((town, position) => {
          const first = position === 0;
          return (
            <li
              aria-roledescription="slide"
              className={cn(
                'relative isolate flex w-full shrink-0 snap-start snap-always flex-col justify-end overflow-hidden',
                COVER_HEIGHT,
              )}
              data-slot="finds-cover-slide"
              key={town.name}
            >
              <TripMedia
                alt=""
                className={cn(
                  'absolute inset-0 -z-20 h-full w-full rounded-none',
                  first && enter && pageEntrance.media,
                )}
                preload={first}
                sizes="100vw"
                source={resolveTripMediaSource({ coverUrl: null, editorial: town.editorial })}
                variant="cover"
              />
              <div aria-hidden="true" className={SCRIM} />
              <div className={MEASURE}>
                <div
                  className={cn(
                    'mx-auto w-full max-w-6xl pt-[calc(var(--safe-top)+5rem)] pb-24 md:pt-[calc(var(--safe-top)+var(--header-height)+3rem)] md:pb-28',
                    first && enter && pageEntrance.rise,
                  )}
                >
                  <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-white/80 uppercase">
                    {t('kicker', { count: total })}
                  </p>
                  <p className="mt-3 text-base text-white/85">{t('lead')}</p>
                  <h2 className="mt-1 max-w-[14ch] font-journal text-[clamp(3.25rem,14vw,5.5rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">
                    {town.name}
                  </h2>
                  <p className="mt-2 text-sm text-white/80 tabular-nums">
                    {t('meta', { count: town.count, since: town.since })}
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Button
                      className="rounded-full bg-white text-neutral-900 hover:bg-white/90"
                      onClick={onPlanTrip}
                      size="lg"
                    >
                      {t('planTrip')}
                    </Button>
                    <a
                      className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] text-sm font-semibold text-white/90 outline-none hover:text-white hover:underline focus-visible:ring-3 focus-visible:ring-white/70"
                      href={`#${town.anchor}`}
                    >
                      {t('browse')}
                    </a>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {towns.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-11 z-20 md:bottom-14">
          <div className={MEASURE}>
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
              <div className="pointer-events-auto flex items-center">
                {towns.map((town, position) => (
                  <button
                    aria-current={position === index ? 'true' : undefined}
                    aria-label={town.name}
                    className="grid h-8 min-w-5 place-items-center rounded-full px-1 outline-none focus-visible:ring-3 focus-visible:ring-white/70"
                    key={town.name}
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
                {t('position', { current: index + 1, total: towns.length })}
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
                    disabled={target < 0 || target >= towns.length}
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
