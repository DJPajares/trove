'use client';

import { ArrowUpRight } from 'lucide-react';
import { motion, useReducedMotion, type PanInfo } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { DayHeaderMedia } from '@/components/day-header-media';
import type { DayFacts, dayHeading } from '@/lib/itinerary/day-facts';
import type { DayHeaderPhotoResolution } from '@/lib/media/day-header-photos';

import { DayNote, DayTitle } from './day-inline-edit';
import { DaySummary } from './day-summary';
import { paddedDayNumber } from './planner-ribbon';

/** How far, or how fast, a swipe on the photograph has to travel to change day. */
const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 420;

/**
 * The top of a day: what it is called, where it is, and what shape it is in.
 *
 * It opens on the shared content-aware day photograph, with a trip secondary
 * image and bundled photographic artwork reserved for genuine failures,
 * with the day's number and name set over it, its options and Plan Score
 * above. Beneath, its weather, then what the day is - its measures beside its
 * route as a sketch that opens the real map - and its note. The title and the
 * note are edited where they are read; where the day starts and ends is shown
 * once, on the timeline itself.
 *
 * The date is said once (PRD 17.2.1): under the title, or as the title when the
 * day has nothing better to be called. Swiping the photograph turns to the next
 * or previous day; the ribbon above does the same for every other input.
 */
export function DayMasthead({
  actions,
  dayMenu,
  attention,
  compactTravel,
  date,
  dayId,
  dayNumber,
  facts,
  heading,
  photos,
  isToday,
  name,
  note,
  onNextDay,
  onOpenMap,
  onPreviousDay,
  onRename,
  onSaveNote,
  routeNotes,
  routesLoading,
  scoreChip,
  sketch,
  unmapped,
  weather,
}: Readonly<{
  /** What a wide screen offers beside the day's content: adding a stop. */
  actions?: ReactNode;
  /** The day's own options, as a pill on its photograph. */
  dayMenu: ReactNode;
  /** The day's own problem worth a look, when it names no single stop. */
  attention?: ReactNode;
  /** The traveller turned travel details off; the day says nothing about travel. */
  compactTravel: boolean;
  date: string;
  dayId: string;
  dayNumber: number;
  facts: DayFacts;
  heading: ReturnType<typeof dayHeading>;
  photos: DayHeaderPhotoResolution;
  isToday: boolean;
  /** The day's own name, when it has one; the heading may be its town or date. */
  name: string | null;
  note: string | null;
  onNextDay?: () => void;
  onOpenMap: () => void;
  onPreviousDay?: () => void;
  onRename: (name: string | null) => Promise<boolean>;
  onSaveNote: (note: string | null) => Promise<boolean>;
  /** What the day's travel estimate is obliged to say about itself. */
  routeNotes?: ReactNode;
  routesLoading: boolean;
  scoreChip?: ReactNode;
  /** The day's route, drawn from what the trip already holds. */
  sketch: ReactNode;
  /** Stops with nowhere to be on a map, which the drawing leaves out. */
  unmapped: number;
  /** The day's own weather, under its photograph. */
  weather: ReactNode;
}>) {
  const t = useTranslations('itinerary.planner.masthead');
  const locale = useLocale();
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
          className="absolute inset-0 h-full w-full rounded-none sm:h-full"
          dataSlot="day-masthead-photo"
          preload
          sizes="(max-width: 1023px) 100vw, 640px"
          resolution={photos}
          variant="banner"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-neutral-950/80 via-neutral-950/30 to-neutral-950/5"
        />
        <div className="pointer-events-none relative flex min-h-44 flex-col p-4 text-media-fallback-foreground sm:min-h-52 sm:p-6 lg:min-h-56">
          <div className="flex items-start justify-between gap-3">
            <div className="pointer-events-auto shrink-0">{dayMenu}</div>
            {scoreChip ? <div className="pointer-events-auto min-w-0">{scoreChip}</div> : null}
          </div>
          <div className="mt-3 flex flex-1 flex-col justify-end">
            <p aria-hidden="true" className="flex shrink-0 items-end gap-2 leading-none">
              <span className="pb-1 text-[length:var(--text-metadata)] font-semibold tracking-[0.14em] uppercase opacity-85">
                {isToday ? t('today') : t('kicker')}
              </span>
              <span className="text-[2.75rem] font-semibold tracking-[-0.045em] tabular-nums sm:text-[3.25rem]">
                {paddedDayNumber(dayNumber)}
              </span>
            </p>
            <DayTitle
              display={heading.source === 'date' ? longDate : heading.title}
              headingId={`itinerary-day-${dayId}`}
              key={dayId}
              name={name}
              numberLabel={t('dayLabel', { number: dayNumber })}
              onRename={onRename}
            />
            {heading.source === 'date' ? null : (
              <p className="mt-1 text-sm opacity-85">{longDate}</p>
            )}
          </div>
        </div>
      </motion.div>

      {weather}

      {/* What the day is, and what can be done with it, read as one block. */}
      <div className="space-y-3">
        <div className="flex items-stretch gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <DaySummary compactTravel={compactTravel} facts={facts} routesLoading={routesLoading} />
            {routeNotes}
          </div>

          {/* The day's shape at a glance, and the way into the real map. */}
          <button
            aria-label={t('openMapLabel', { number: dayNumber })}
            className="group flex w-28 shrink-0 flex-col gap-1.5 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-1.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:border-border hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none sm:w-36 lg:hidden"
            // Where focus returns when the map is closed by its own way back.
            data-planner-open-map=""
            onClick={onOpenMap}
            type="button"
          >
            <span className="relative block min-h-[4.5rem] flex-1 overflow-hidden rounded-[var(--radius-md)] bg-surface-tint/60 bg-[radial-gradient(circle,var(--color-border)_0.75px,transparent_1px)] bg-[length:9px_9px]">
              <span className="absolute inset-0 p-0.5">{sketch}</span>
              {unmapped ? (
                <span className="absolute bottom-1 left-1 rounded-full bg-card/90 px-1.5 py-0.5 text-[0.625rem] leading-none font-medium text-muted-foreground">
                  {t('unmapped', { count: unmapped })}
                </span>
              ) : null}
            </span>
            <span className="flex items-center justify-between px-1 pb-0.5 text-xs font-medium text-foreground">
              {t('openMap')}
              <ArrowUpRight
                aria-hidden="true"
                className="size-3.5 text-muted-foreground transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
              />
            </span>
          </button>
        </div>

        <DayNote key={dayId} note={note} onSave={onSaveNote} />
        {actions ? <div className="hidden items-center gap-2 md:flex">{actions}</div> : null}
      </div>

      {attention}
    </header>
  );
}
