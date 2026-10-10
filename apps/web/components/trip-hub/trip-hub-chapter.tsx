'use client';

import type { TripOverviewData, TripOverviewDay, TripOverviewStop } from '@trove/types';
import { ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, type ComponentType } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { TripInsights } from '@/components/trip-insights';
import { TripReadinessPrompt } from '@/components/trip-readiness-prompt';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import * as Icons from '@/lib/icons';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import {
  canDecodeHeic,
  isHeicContentType,
  shouldRefreshSignedMedia,
} from '@/lib/memories/signed-media';
import type { Trip } from '@/lib/trips/api';
import { calendarDayDistance } from '@/lib/trips/lifecycle';
import { tripOverviewDestinations, type TripSection } from '@/lib/trips/navigation';
import { overviewPlannerHref, type TripHubStage } from '@/lib/trips/overview';
import { cn } from '@/lib/utils';

const pad = (value: number) => String(value).padStart(2, '0');

/** Day-only values are calendar dates, so they are read in UTC to keep their day. */
function formatDay(date: string, locale: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

const kickerClass = 'text-[length:var(--text-metadata)] font-semibold tracking-[0.14em] uppercase';

function StopLine({ clockTimeZone, stop }: { clockTimeZone: string; stop: TripOverviewStop }) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const time = stop.startInstant
    ? new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: clockTimeZone,
      }).format(new Date(stop.startInstant))
    : stop.localStartTime;
  const now = stop.kind === 'current';
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-baseline gap-3">
      <span
        className={cn(
          'flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.12em] uppercase',
          now ? 'text-brand' : 'text-muted-foreground',
        )}
      >
        {now ? (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-brand ring-3 ring-brand/20"
          />
        ) : null}
        {t(`stopKind.${stop.kind}`)}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 font-semibold text-pretty break-words">
          {stop.label ?? t('unnamedStop')}
        </span>
        {time ? (
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{time}</span>
        ) : null}
      </span>
    </div>
  );
}

/** Every day at a glance while the plan is being made: the open ones drawn open. */
function DayTiles({
  days,
  focusDayId,
  tripId,
}: Readonly<{ days: readonly TripOverviewDay[]; focusDayId: string | null; tripId: string }>) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  return (
    <ol aria-label={t('daysLabel')} className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {days.map((day) => {
        const planned = day.stopCount > 0;
        const focused = day.id === focusDayId;
        return (
          <li className="min-w-[4.25rem] flex-1" key={day.id}>
            <Link
              aria-current={focused ? 'true' : undefined}
              aria-label={t(planned ? 'dayTilePlanned' : 'dayTileOpen', {
                date: formatDay(day.date, locale, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }),
                number: day.number,
              })}
              className={cn(
                'flex h-[5.25rem] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-lg)] px-1 text-center outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                planned
                  ? 'border border-border-subtle bg-card hover:bg-surface-hover'
                  : 'border-[1.5px] border-dashed border-border-strong text-muted-foreground hover:bg-surface-hover',
                focused &&
                  'border-transparent bg-surface-tint text-foreground ring-2 ring-brand ring-inset',
              )}
              href={overviewPlannerHref(tripId, day.id)}
            >
              <span
                className={cn(
                  'text-[0.625rem] font-semibold tracking-[0.1em] uppercase',
                  focused ? 'text-brand' : 'text-muted-foreground',
                )}
              >
                {formatDay(day.date, locale, { weekday: 'short' })}
              </span>
              <span className="text-[1.375rem] leading-tight font-semibold tracking-[-0.04em] tabular-nums">
                {pad(day.number)}
              </span>
              <span
                className={cn(
                  'max-w-full truncate text-[0.6875rem]',
                  planned ? 'text-muted-foreground' : 'font-semibold text-accent-strong',
                )}
              >
                {planned ? (day.town ?? t('plannedShort')) : t('openShort')}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** The day the plan most needs next, or the one about to begin. */
function FocusDay({
  clockTimeZone,
  day,
  town,
}: Readonly<{
  clockTimeZone: string;
  day: NonNullable<TripOverviewData['day']>;
  town: string | null;
}>) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const date = formatDay(day.date, locale, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-card)]">
      <p className={cn(kickerClass, 'text-[0.6875rem] text-muted-foreground tabular-nums')}>
        {town
          ? t('dayKickerTown', { number: pad(day.number), date, town })
          : t('dayKicker', { number: pad(day.number), date })}
      </p>
      <p className="mt-1.5 text-lg leading-snug font-semibold tracking-[-0.015em] text-balance break-words">
        {day.name ??
          (day.state === 'empty' ? t('openDayTitle') : t('plannedDay', { count: day.stopCount }))}
      </p>
      {day.name || day.state === 'empty' ? (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {day.state === 'empty' ? t('openDay') : t('plannedDay', { count: day.stopCount })}
        </p>
      ) : null}
      {day.next ? (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <StopLine clockTimeZone={clockTimeZone} stop={day.next} />
        </div>
      ) : null}
    </div>
  );
}

const doorIcons: Record<TripSection, ComponentType<{ className?: string }>> = {
  expenses: Icons.Expenses,
  info: Icons.TripInfo,
  itinerary: Icons.Itinerary,
  memories: Icons.Memories,
  mode: Icons.TripMode,
  reservations: Icons.Reservations,
  tasks: Icons.Tasks,
};

/** The two experiences the chapter does not lead with, each with a line on what it is for. */
function ExperienceDoors({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips');
  const destinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  return (
    <nav aria-label={t('tripExperiences')} className="grid grid-cols-2 gap-2.5">
      {destinations.secondary.map((destination) => {
        const Icon =
          destination.displayLabelKey === 'preview' ||
          destination.descriptionKey === 'previewCompleted'
            ? Icons.Preview
            : doorIcons[destination.section];
        return (
          <Link
            className="group flex min-w-0 flex-col gap-3 rounded-[var(--radius-xl)] border border-border-subtle p-3.5 outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
            data-slot="trip-overview-secondary-action"
            href={destination.href}
            key={destination.section}
          >
            <span className="flex items-center justify-between">
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-9 place-items-center rounded-full bg-surface-tint',
                  destination.section === 'memories' ? 'text-accent-strong' : 'text-brand',
                )}
              >
                <Icon className="size-[1.125rem]" />
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </span>
            <span>
              <span className="block text-[0.9375rem] font-semibold">
                {t(destination.displayLabelKey)}
              </span>
              <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">
                {t(`experienceDescription.${destination.descriptionKey}`)}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Up to three of the traveller's own photographs, set down like prints. */
function MemoryPrints({
  onExpired,
  photos,
  tripId,
}: Readonly<{
  onExpired: () => void;
  photos: TripOverviewData['memories']['photos'];
  tripId: string;
}>) {
  const t = useTranslations('trips.hub');
  const lastRefreshAt = useRef<number | null>(null);
  const tilts = ['-rotate-6', 'rotate-3', '-rotate-2'];
  return (
    <div aria-label={t('memoryPreview')} className="flex justify-center px-2 py-3" role="group">
      {photos.map((photo, index) => (
        <Link
          aria-label={t('openMemories')}
          className={cn(
            'relative -mx-2 w-[36%] max-w-44 bg-paper-print p-1.5 pb-6 shadow-[var(--shadow-print)] outline-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] hover:rotate-0 focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
            tilts[index],
            index === 1 && 'z-10 -translate-y-2',
          )}
          href={`/trips/${tripId}/memories`}
          key={photo.id}
        >
          <MediaFrame
            alt=""
            className="aspect-[4/5] rounded-[1px]"
            dataSlot="trip-hub-memory"
            onUnreachable={() => {
              const now = Date.now();
              if (
                shouldRefreshSignedMedia({
                  canDecodeHeic: canDecodeHeic(),
                  contentType: photo.contentType,
                  lastRefreshAt: lastRefreshAt.current,
                  now,
                  online: navigator.onLine,
                  url: photo.url,
                })
              ) {
                lastRefreshAt.current = now;
                void forgetCachedMediaUrls([photo.url]).finally(onExpired);
              }
            }}
            sizes="(max-width: 767px) 36vw, 176px"
            source={{ kind: 'memory', url: photo.url }}
            variant="card"
          />
        </Link>
      ))}
    </div>
  );
}

/** Where the prints will go: a page left open on purpose, not a gap. */
function EmptyPrints() {
  return (
    <div aria-hidden="true" className="flex justify-center px-2 py-3">
      {['-rotate-6', 'rotate-3', '-rotate-2'].map((tilt, index) => (
        <span
          className={cn(
            'relative -mx-2 grid aspect-[4/5] w-[30%] max-w-36 place-items-center border-[1.5px] border-dashed border-border-strong bg-paper-print',
            tilt,
            index === 1 && 'z-10 -translate-y-2 text-accent-strong',
          )}
          key={tilt}
        >
          {index === 1 ? <Icons.Memories className="size-6" /> : null}
        </span>
      ))}
    </div>
  );
}

/**
 * One current chapter, not a second itinerary: what matters for this trip now,
 * one way in, and the two other experiences a step away. Detail opens in its
 * own experience.
 */
export function TripHubChapter({
  failed,
  loading,
  onRetry,
  overview,
  showReadiness,
  stage,
  trip,
}: Readonly<{
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
  overview: TripOverviewData | undefined;
  showReadiness: boolean;
  stage: TripHubStage;
  trip: Trip;
}>) {
  const t = useTranslations('trips.hub');
  const locale = useLocale();
  const day = overview?.day ?? null;
  const days = overview?.days ?? [];
  const totalDays = calendarDayDistance(trip.startDate, trip.endDate) + 1;
  const destinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  const photos = (overview?.memories.photos ?? []).filter(
    (photo) => canDecodeHeic() || !isHeicContentType(photo.contentType),
  );
  const reflection = trip.experienceNote?.trim() || overview?.memories.note?.trim();
  const hasStory = Boolean(
    trip.memoryCount || trip.hasStoryContent || overview?.memories.note || photos.length,
  );
  const remember = stage === 'remember';
  const href =
    stage === 'plan' || stage === 'soon'
      ? overviewPlannerHref(trip.id, day?.id ?? null)
      : destinations.primary.href;
  const action =
    stage === 'remember'
      ? t(hasStory ? 'openMemories' : 'addMemories')
      : stage === 'live'
        ? t('continueTrip')
        : stage === 'soon'
          ? t('reviewItinerary')
          : day?.state === 'empty'
            ? t('planDay', { number: day.number })
            : t('continuePlanning');

  return (
    <section
      aria-labelledby="trip-chapter-heading"
      className={cn(
        'flex min-w-0 flex-col gap-5 lg:flex-1',
        remember
          ? '-mx-[var(--gutter-inline-start)] bg-paper px-[var(--gutter-inline-start)] py-8 lg:mx-0 lg:rounded-[var(--radius-2xl)] lg:px-8'
          : 'pt-6 lg:rounded-[var(--radius-2xl)] lg:border lg:border-border-subtle lg:bg-card lg:p-7',
      )}
      data-slot="trip-hub-chapter"
    >
      <p
        className={cn(kickerClass, remember ? 'tracking-[0.2em] text-accent-strong' : 'text-brand')}
      >
        {t(
          remember
            ? 'chapter.remember'
            : stage === 'live'
              ? 'chapter.live'
              : stage === 'soon'
                ? 'chapter.soon'
                : 'chapter.plan',
        )}
      </p>

      {remember ? (
        <>
          <h2
            className="-mt-2 max-w-[14ch] font-journal text-[2.75rem] leading-[0.95] font-normal tracking-[-0.01em] text-balance"
            id="trip-chapter-heading"
          >
            {t(hasStory ? 'rememberTitle' : 'rememberEmptyTitle')}
          </h2>
          {photos.length ? (
            <MemoryPrints onExpired={onRetry} photos={photos} tripId={trip.id} />
          ) : hasStory ? null : (
            <EmptyPrints />
          )}
          {reflection ? (
            <blockquote className="line-clamp-4 font-journal text-2xl leading-snug font-normal italic">
              {reflection}
            </blockquote>
          ) : (
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              {t(hasStory ? 'rememberBody' : 'rememberEmptyBody')}
            </p>
          )}
          {trip.memoryCount ? (
            <p className="-mt-2 text-sm text-muted-foreground tabular-nums">
              {t('moments', { count: trip.memoryCount })}
            </p>
          ) : null}
        </>
      ) : stage === 'live' ? (
        <>
          {day ? (
            <div className="flex items-end gap-4">
              <p aria-hidden="true" className="flex shrink-0 items-baseline">
                <span className="text-[4.75rem] leading-[0.8] font-semibold tracking-[-0.06em] tabular-nums">
                  {pad(day.number)}
                </span>
                <span className="ml-1.5 text-base font-medium text-muted-foreground tabular-nums">
                  {t('dayTotal', { total: pad(totalDays) })}
                </span>
              </p>
              <div className="min-w-0 pb-0.5">
                <h2
                  className="text-[1.75rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance break-words"
                  id="trip-chapter-heading"
                >
                  <span className="sr-only">
                    {t('todayTitle', { number: day.number, total: totalDays })}:{' '}
                  </span>
                  {day.name ?? days.find((entry) => entry.id === day.id)?.town ?? t('liveTitle')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDay(day.date, locale, { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
            </div>
          ) : (
            <h2
              className="text-2xl leading-tight font-semibold tracking-[-0.03em] text-balance"
              id="trip-chapter-heading"
            >
              {t('liveTitle')}
            </h2>
          )}
          {loading ? (
            <ChapterSkeleton label={t('loading')} />
          ) : day ? (
            <div className="rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 shadow-[var(--shadow-card)]">
              {day.current || day.next ? (
                <ul className="divide-y divide-border-subtle">
                  {day.current ? (
                    <li className="py-3.5">
                      <StopLine clockTimeZone={overview!.clockTimeZone} stop={day.current} />
                    </li>
                  ) : null}
                  {day.next ? (
                    <li className="py-3.5">
                      <StopLine clockTimeZone={overview!.clockTimeZone} stop={day.next} />
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="py-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
                  {t(day.state === 'empty' ? 'todayEmpty' : 'todayFinished')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{t('noDay')}</p>
          )}
          {day ? (
            <TripInsights dayId={day.id} headingLevel={3} initialItemLimit={1} tripId={trip.id} />
          ) : null}
        </>
      ) : (
        <>
          <h2
            className="text-[1.75rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance"
            id="trip-chapter-heading"
          >
            {t(stage === 'soon' ? 'reviewTitle' : 'planTitle')}
          </h2>
          {days.length > 1 ? (
            <DayTiles days={days} focusDayId={day?.id ?? null} tripId={trip.id} />
          ) : null}
          {loading ? (
            <ChapterSkeleton label={t('loading')} />
          ) : day && overview ? (
            <FocusDay
              clockTimeZone={overview.clockTimeZone}
              day={day}
              town={days.find((entry) => entry.id === day.id)?.town ?? null}
            />
          ) : (
            <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
              {t('planBody')}
            </p>
          )}
          {showReadiness ? <TripReadinessPrompt trip={trip} /> : null}
        </>
      )}

      {failed ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          {t('unavailable')}
          <Button onClick={onRetry} size="sm" variant="ghost">
            {t('retry')}
          </Button>
        </div>
      ) : null}

      <Link
        className={cn(
          buttonVariants({ size: 'lg' }),
          'h-auto min-h-12 w-full rounded-[var(--radius-lg)] py-3 text-[0.9375rem] whitespace-normal lg:mt-auto',
        )}
        data-slot="trip-overview-primary-action"
        href={href}
      >
        <span className="min-w-0">{action}</span>
        {stage === 'plan' || stage === 'soon' ? (
          <ArrowRight aria-hidden="true" className="size-4" />
        ) : (
          <ArrowUpRight aria-hidden="true" className="size-4" />
        )}
      </Link>
      <ExperienceDoors trip={trip} />
    </section>
  );
}

function ChapterSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-3" role="status">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
