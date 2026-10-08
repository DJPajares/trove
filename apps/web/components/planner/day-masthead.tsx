'use client';

import { ArrowUpRight } from 'lucide-react';
import { motion, useReducedMotion, type PanInfo } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, type ReactNode } from 'react';

import { DayHeaderMedia } from '@/components/day-header-media';
import { usePreferences } from '@/components/preferences-provider';
import { TripDayWeather } from '@/components/trip-day-weather';
import type { DayFacts, dayHeading } from '@/lib/itinerary/day-facts';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatPlannedDuration, formatTravelDuration } from '@/lib/itinerary/route-format';
import type { TripMediaSource } from '@/lib/media/trip-media';
import { cn } from '@/lib/utils';
import type { TripWeatherDay } from '@/lib/weather/api';
import * as Icons from '@/lib/icons';

import { paddedDayNumber } from './planner-ribbon';

/** How far, or how fast, a swipe on the photograph has to travel to change day. */
const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 420;

export type DayStay =
  | { kind: 'none' }
  | { kind: 'same'; name: string }
  | { from: string; kind: 'transition'; to: string };

function FactsLine({ children }: Readonly<{ children: ReactNode[] }>) {
  const parts = children.filter(Boolean);
  if (!parts.length) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index ? (
            <span aria-hidden="true" className="text-text-subtle">
              ·
            </span>
          ) : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The top of a day: what it is called, where it is, and what shape it is in.
 *
 * It opens on the shared content-aware day photograph, with a trip secondary
 * image and a bundled photographic fallback keeping the frame complete,
 * with the day's number and name set over it. Beneath, one line of facts, the
 * Stay it runs from, and the day's route as a sketch that opens the real map.
 *
 * The date is said once (PRD 17.2.1): under the title, or as the title when the
 * day has nothing better to be called. Swiping the photograph turns to the next
 * or previous day; the ribbon above does the same for every other input.
 */
export function DayMasthead({
  actions,
  attention,
  compactTravel,
  date,
  dayId,
  dayNumber,
  facts,
  heading,
  photos,
  isToday,
  note,
  onNextDay,
  onOpenMap,
  onPreviousDay,
  onStayClick,
  routeNotes,
  routesLoading,
  scoreChip,
  sketch,
  stay,
  weather,
}: Readonly<{
  actions: ReactNode;
  /** The day's own problem worth a look, when it names no single stop. */
  attention?: ReactNode;
  /** The traveller turned travel details off; the day says nothing about travel. */
  compactTravel: boolean;
  date: string;
  dayId: string;
  dayNumber: number;
  facts: DayFacts;
  heading: ReturnType<typeof dayHeading>;
  photos: readonly TripMediaSource[];
  isToday: boolean;
  note: string | null;
  onNextDay?: () => void;
  onOpenMap: () => void;
  onPreviousDay?: () => void;
  onStayClick: () => void;
  /** What the day's travel estimate is obliged to say about itself. */
  routeNotes?: ReactNode;
  routesLoading: boolean;
  scoreChip?: ReactNode;
  /** The drawn route, when the day has enough located places to draw one. */
  sketch: ReactNode | null;
  stay: DayStay;
  weather: TripWeatherDay | null;
}>) {
  const t = useTranslations('itinerary.planner.masthead');
  const routesT = useTranslations('itinerary.routes');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const reduced = useReducedMotion();

  const longDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00.000Z`));

  function onSwipe(_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    const forward = info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY;
    const back = info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY;
    if (forward) onNextDay?.();
    else if (back) onPreviousDay?.();
  }

  const travel = compactTravel ? null : facts.travel;
  const unit = routesT(`units.${preferences.distanceUnit}`);

  return (
    <header
      aria-labelledby={`itinerary-day-${dayId}`}
      className="space-y-4"
      data-slot="day-masthead"
    >
      <motion.div
        className="relative isolate touch-pan-y overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media"
        drag={reduced ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.16}
        dragSnapToOrigin
        onDragEnd={onSwipe}
      >
        <DayHeaderMedia
          alt=""
          category="destination"
          className="absolute inset-0 h-full w-full rounded-none"
          dataSlot="day-masthead-photo"
          preload
          sizes="(max-width: 1023px) 100vw, 640px"
          photos={photos}
          variant="banner"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-neutral-950/80 via-neutral-950/30 to-neutral-950/5"
        />
        <div className="pointer-events-none relative flex min-h-44 flex-col p-4 text-media-fallback-foreground sm:min-h-52 sm:p-6 lg:min-h-56">
          {scoreChip ? (
            <div className="pointer-events-auto max-w-full self-end">{scoreChip}</div>
          ) : null}
          <div className={cn('flex flex-1 flex-col justify-end', scoreChip && 'mt-3')}>
            <p aria-hidden="true" className="flex shrink-0 items-end gap-2 leading-none">
              <span className="pb-1 text-[length:var(--text-metadata)] font-semibold tracking-[0.14em] uppercase opacity-85">
                {isToday ? t('today') : t('kicker')}
              </span>
              <span className="text-[2.75rem] font-semibold tracking-[-0.045em] tabular-nums sm:text-[3.25rem]">
                {paddedDayNumber(dayNumber)}
              </span>
            </p>
            <h2
              className="mt-1.5 text-[length:var(--text-section-title)] leading-tight font-semibold tracking-[-0.015em] text-balance break-words outline-none"
              id={`itinerary-day-${dayId}`}
              tabIndex={-1}
            >
              <span className="sr-only">{t('dayLabel', { number: dayNumber })}: </span>
              {heading.source === 'date' ? longDate : heading.title}
            </h2>
            {heading.source === 'date' ? null : (
              <p className="mt-1 text-sm opacity-85">{longDate}</p>
            )}
          </div>
        </div>
      </motion.div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <FactsLine>
            {[
              weather ? <TripDayWeather forecast={weather} key="weather" /> : null,
              <span key="stops">{t('stops', { count: facts.stopCount })}</span>,
              facts.planned ? (
                <span key="planned">
                  {t(facts.planned.approximate ? 'plannedApproximate' : 'planned', {
                    duration: formatPlannedDuration(facts.planned.minutes, locale),
                  })}
                </span>
              ) : null,
              compactTravel ? null : routesLoading && !travel ? (
                <span className="animate-pulse motion-reduce:animate-none" key="travel">
                  {t('measuringTravel')}
                </span>
              ) : travel?.kind === 'known' ? (
                <span key="travel">
                  {routesT(travel.partial ? 'knownDuration' : 'duration', {
                    value: formatTravelDuration(travel.durationSeconds, locale),
                  })}
                </span>
              ) : travel?.kind === 'unavailable' ? (
                <span key="travel">{routesT('travelTimeUnavailable')}</span>
              ) : travel?.kind === 'long_distance_only' ? (
                <span key="travel">{routesT('noLocalTravel')}</span>
              ) : null,
              travel?.kind === 'known' && travel.distanceMeters !== null ? (
                <span key="distance">
                  {routesT(travel.partial ? 'knownDistance' : 'distance', {
                    unit,
                    value: formatDistanceValue(
                      travel.distanceMeters,
                      preferences.distanceUnit,
                      locale,
                    ),
                  })}
                </span>
              ) : null,
            ]}
          </FactsLine>

          <button
            className="-mx-1.5 flex min-h-9 max-w-full items-center gap-2 rounded-[var(--radius-md)] px-1.5 text-left text-sm outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
            onClick={onStayClick}
            type="button"
          >
            <Icons.DailyBase aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span
              className={cn(
                'min-w-0 truncate',
                stay.kind === 'none' ? 'text-muted-foreground' : 'font-medium text-foreground',
              )}
            >
              {stay.kind === 'none'
                ? t('noStay')
                : stay.kind === 'same'
                  ? t('stay', { name: stay.name })
                  : t('stayTransition', { from: stay.from, to: stay.to })}
            </span>
          </button>
          {routeNotes}
        </div>

        <button
          aria-label={t('openMapLabel', { number: dayNumber })}
          className="group flex w-28 shrink-0 flex-col items-stretch gap-1 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-1.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none sm:w-32 lg:hidden"
          // Where focus returns when the map is closed by its own way back.
          data-planner-open-map=""
          onClick={onOpenMap}
          type="button"
        >
          {sketch ?? (
            <span
              aria-hidden="true"
              className="grid aspect-[8/5] place-items-center rounded-[var(--radius-md)] bg-surface-tint/60 text-muted-foreground"
            >
              <Icons.MapView className="size-5" />
            </span>
          )}
          <span className="flex items-center justify-between px-1 pb-0.5 text-xs font-medium text-foreground">
            {t('openMap')}
            <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </span>
        </button>
      </div>

      {attention}

      <div className="flex flex-wrap items-center gap-2">{actions}</div>

      {note ? (
        <p className="flex max-w-2xl gap-2 text-sm leading-6 whitespace-pre-wrap text-text-subtle">
          <Icons.Notes aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <span className="min-w-0">{note}</span>
        </p>
      ) : null}
    </header>
  );
}
