'use client';

import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import { summarizeToday, type TodayRowState } from '@/lib/home/today';
import type { Trip } from '@/lib/trips/api';
import { itemLabel } from '@/lib/trips/next-up';
import { cn } from '@/lib/utils';

function TimelineMark({ state }: Readonly<{ state: TodayRowState }>) {
  if (state === 'done') {
    return (
      <span className="grid size-5 place-items-center rounded-full bg-status-success/15 text-status-success">
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      </span>
    );
  }

  return (
    <span className="grid size-5 place-items-center">
      <span
        className={cn(
          'rounded-full',
          state === 'current' && 'size-3 bg-brand ring-4 ring-brand/20',
          state === 'next' && 'size-2.5 border-2 border-brand bg-background',
          (state === 'upcoming' || state === 'skipped') && 'size-2 bg-border-strong',
        )}
      />
    </span>
  );
}

/**
 * The rest of today, for a trip under way: from wherever the traveller is in
 * their day, the next few stops with their times, the one happening now and
 * the one after it called out (PRD 9.3). It reads the Trip Mode context Home
 * already fetched for this trip, and opens Trip Mode's own Today for the
 * whole day - Home shows where the day stands, Trip Mode runs it.
 */
export function HomeToday({
  context,
  loading,
  trip,
}: Readonly<{ context: TripModeContext | null; loading: boolean; trip: Trip }>) {
  const t = useTranslations('home.today');
  const scheduleT = useTranslations('itinerary.schedule');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const summary = summarizeToday(context);
  const day = context?.day ?? null;

  const when = (item: ItineraryItem) =>
    formatItineraryTimeRange(
      { durationMinutes: null, localEndTime: null, localStartTime: item.localStartTime },
      locale,
      preferences.timeFormat,
    ) ?? (item.dayPart ? scheduleT(item.dayPart) : null);

  return (
    <section
      aria-labelledby="home-today-heading"
      className="flex flex-col rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-5 shadow-[var(--shadow-card)] sm:p-6"
      data-slot="home-today"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
          id="home-today-heading"
        >
          {t('title')}
        </h2>
        {day ? (
          <p className="min-w-0 truncate text-sm text-muted-foreground tabular-nums">
            {day.name
              ? t('dayNamed', { name: day.name, number: day.number })
              : t('day', { number: day.number })}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex-1">
        {loading ? (
          <div aria-busy="true" className="space-y-4" role="status">
            <span className="sr-only">{t('loading')}</span>
            {[0, 1, 2].map((index) => (
              <div className="flex items-center gap-3" key={index}>
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ) : !summary || summary.total === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">{t('free')}</p>
        ) : summary.rows.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">{t('allDone')}</p>
        ) : (
          <>
            {summary.earlier ? (
              <p className="mb-3 text-[length:var(--text-metadata)] text-text-subtle">
                {t('earlier', { count: summary.earlier })}
              </p>
            ) : null}
            <ol className="relative space-y-1 before:absolute before:start-[calc(4.5rem+0.75rem+0.625rem)] before:top-3 before:bottom-3 before:w-px before:bg-border-subtle">
              {summary.rows.map(({ item, state }) => {
                const label = itemLabel(item) ?? t('untitled');
                const time = when(item);
                return (
                  <li
                    className={cn(
                      'relative grid grid-cols-[4.5rem_1.25rem_minmax(0,1fr)] items-center gap-x-3 rounded-[var(--radius-md)] py-2',
                      state === 'current' && 'bg-surface-tint/70',
                    )}
                    key={item.id}
                  >
                    <span className="ps-1 text-end whitespace-nowrap text-[length:var(--text-metadata)] font-medium text-muted-foreground tabular-nums">
                      {time}
                    </span>
                    <TimelineMark state={state} />
                    <span className="flex min-w-0 items-center justify-between gap-2 pe-2">
                      <span
                        className={cn(
                          'truncate text-sm',
                          state === 'current' || state === 'next'
                            ? 'font-semibold text-foreground'
                            : 'text-foreground',
                          state === 'skipped' && 'text-muted-foreground line-through',
                        )}
                      >
                        {label}
                      </span>
                      {state === 'current' || state === 'next' || state === 'skipped' ? (
                        <span
                          className={cn(
                            'shrink-0 text-[0.6875rem] font-semibold tracking-[0.1em] uppercase',
                            state === 'skipped' ? 'text-text-subtle' : 'text-brand',
                          )}
                        >
                          {t(`state.${state}`)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {summary.later ? (
              <p className="mt-3 ps-[calc(4.5rem+1.25rem+1.5rem)] text-[length:var(--text-metadata)] text-text-subtle">
                {t('later', { count: summary.later })}
              </p>
            ) : null}
          </>
        )}
      </div>

      <Link
        className="group mt-5 inline-flex items-center gap-1 self-start rounded-[var(--radius-sm)] text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
        href={`/trips/${trip.id}/mode/today`}
      >
        {t('open')}
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    </section>
  );
}
