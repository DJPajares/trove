'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { useTripReadOnly } from '@/components/trip-provider';
import type { ItineraryItem } from '@/lib/itinerary/api';
import type { BandedEntry } from '@/lib/itinerary/day-bands';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { cn } from '@/lib/utils';

import type { StopView } from './stop-card';

/** Time, rail, words, and room for the dot that says a stop needs a look. */
const ROW = 'grid grid-cols-[4rem_1.75rem_minmax(0,1fr)_0.75rem] gap-x-2.5';

/**
 * The day as a plain list, the way Trip Mode's Today reads it: when, a mark on
 * one rail, and what - with the travel between as a quiet line. It is for
 * reading the day, so a row only opens its stop; building the day - dragging,
 * the stop's menu, adding between two stops - stays with the cards.
 *
 * The marks keep the planner's numbers, because here they are what ties a row
 * to its pin on the map beside it.
 */
export function DaySimpleList({
  entries,
  hasAttention,
  label,
  onAddStop,
  onOpenBase,
  onOpenItem,
  onSelectBase,
  onSelectItem,
  resolveBase,
  resolveItem,
}: Readonly<{
  entries: readonly BandedEntry[];
  /** Something about this stop is worth a look; Detailed says what. */
  hasAttention: (item: ItineraryItem) => boolean;
  label: string;
  /** Adds a stop at the end of the day. */
  onAddStop: () => void;
  onOpenBase: (tripPlaceId: string) => void;
  onOpenItem: (item: ItineraryItem, view: StopView) => void;
  onSelectBase: (tripPlaceId: string) => void;
  onSelectItem: (item: ItineraryItem) => void;
  resolveBase: (
    tripPlaceId: string,
  ) => { located: boolean; name: string; selected: boolean } | null;
  resolveItem: (item: ItineraryItem) => StopView;
}>) {
  const t = useTranslations('itinerary');
  const viewT = useTranslations('itinerary.planner.view');
  const stopT = useTranslations('itinerary.planner.stop');
  const routesT = useTranslations('itinerary.routes');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const readOnly = useTripReadOnly();
  const clock = (value: string) =>
    formatSuggestedClock(value, locale, preferences.timeFormat === '12h');
  const mark =
    'relative z-10 grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums outline-none';

  return (
    <div data-slot="day-simple-list">
      <ol aria-label={label} className="relative border-y border-border-subtle py-1.5">
        {/* One rail behind every mark, as in Trip Mode. */}
        <span
          aria-hidden="true"
          className="absolute top-6 bottom-6 start-[calc(4rem+0.625rem+0.875rem-1px)] w-0.5 rounded-full bg-border"
        />
        {entries.map((entry, index) => {
          if (entry.kind === 'band') return null;

          if (entry.kind === 'leg') {
            const { segment } = entry;
            const estimated = segment.status === 'ok' && segment.durationSeconds !== null;
            return (
              <li
                className={cn(ROW, 'text-xs leading-5 text-muted-foreground tabular-nums')}
                key={`leg-${segment.id}`}
              >
                <span className="col-start-3">
                  {estimated
                    ? viewT('leg', {
                        duration: formatTravelDuration(segment.durationSeconds!, locale),
                        mode: routesT(`mode.${segment.mode}`),
                      })
                    : routesT(`mode.${segment.mode}`)}
                </span>
              </li>
            );
          }

          if (entry.kind === 'base') {
            const base = resolveBase(entry.tripPlaceId);
            if (!base) return null;
            return (
              <li className={cn(ROW, 'items-center py-1.5')} key={`base-${entry.role}-${index}`}>
                <span />
                <span className="flex justify-center">
                  <button
                    aria-label={stopT('showOnMap', { number: entry.stopNumber })}
                    className={cn(
                      mark,
                      'size-3.5 border-2 border-border-strong bg-background focus-visible:ring-3 focus-visible:ring-ring/40',
                      base.selected && 'border-primary ring-4 ring-ring/35',
                    )}
                    disabled={!base.located}
                    onClick={() => onSelectBase(entry.tripPlaceId)}
                    type="button"
                  />
                </span>
                <button
                  className="min-h-9 min-w-0 truncate rounded-[var(--radius-sm)] text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  onClick={() => onOpenBase(entry.tripPlaceId)}
                  type="button"
                >
                  {viewT(entry.role === 'arrival' ? 'startsAt' : 'endsAt', { name: base.name })}
                </button>
              </li>
            );
          }

          const { item } = entry;
          const view = resolveItem(item);
          const place = view.locality ?? item.customLocation?.label ?? null;
          return (
            <li
              className={cn(
                ROW,
                'items-start py-2',
                item.travelStatus === 'skipped' && 'opacity-70',
              )}
              // Plan Score deep links and the map focus a stop by this id.
              id={`itinerary-item-${item.id}`}
              key={item.id}
              tabIndex={-1}
            >
              <span className="pt-1 text-right text-[0.8125rem] leading-5 tabular-nums">
                {item.localStartTime ? (
                  <>
                    <span className="block font-semibold">{clock(item.localStartTime)}</span>
                    {item.localEndTime ? (
                      <span className="block text-muted-foreground">
                        {clock(item.localEndTime)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="block text-muted-foreground">
                    {item.dayPart ? t(`schedule.${item.dayPart}`) : '—'}
                  </span>
                )}
              </span>
              <span className="flex justify-center">
                {view.located ? (
                  <button
                    aria-label={stopT('showOnMap', { number: entry.stopNumber })}
                    className={cn(
                      mark,
                      'bg-primary text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/40',
                      view.selected && 'ring-4 ring-ring/35',
                    )}
                    onClick={() => onSelectItem(item)}
                    type="button"
                  >
                    {entry.stopNumber}
                  </button>
                ) : (
                  <span
                    className={cn(mark, 'border border-border bg-muted text-muted-foreground')}
                    title={stopT('noLocation')}
                  >
                    <span className="sr-only">{t('stopNumber', { number: entry.stopNumber })}</span>
                    <span aria-hidden="true">{entry.stopNumber}</span>
                  </span>
                )}
              </span>
              <button
                className="min-h-11 min-w-0 rounded-[var(--radius-sm)] text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => onOpenItem(item, view)}
                type="button"
              >
                <span className="block text-[0.9375rem] leading-snug font-semibold [overflow-wrap:anywhere]">
                  {view.name}
                </span>
                {place ? (
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    {place}
                  </span>
                ) : null}
              </button>
              {hasAttention(item) ? (
                <span
                  className="mt-2.5 size-2 rounded-full bg-status-warning"
                  title={viewT('needsLook')}
                >
                  <span className="sr-only">{viewT('needsLook')}</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {readOnly ? null : (
        <button
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-sm font-semibold text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
          onClick={onAddStop}
          type="button"
        >
          <Plus aria-hidden="true" className="size-4" />
          {viewT('addStop')}
        </button>
      )}
    </div>
  );
}
