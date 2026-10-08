'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { PlaceHoursNote } from '@/components/place-hours-note';
import { usePreferences } from '@/components/preferences-provider';
import type { ItineraryItem, PlaceHoursStatus } from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { formatItineraryTimeRange, itineraryLocalEndTime } from '@/lib/itinerary/item-timing';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { stopHoursAt } from '@/lib/itinerary/stop-hours';
import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

import { SpineRow, type SpineLine } from './spine';

/**
 * The stop's own words, resolved by the planner that owns the day: its name,
 * whether it has details to open and a pin to match, and where it is.
 */
export type StopView = {
  category: TrovePlaceCategory | undefined;
  /** Backed by a Place, so there are details to open. */
  detailed: boolean;
  /** The town the stop is in, when that is not the day's own town. */
  locality: string | null;
  located: boolean;
  mapsHref: string | null;
  name: string;
  selected: boolean;
};

/**
 * A stop's category as a soft tile in its own colour - the same colours the
 * trip's spending is grouped in - rather than the deep placeholder a missing
 * photograph gets. A column of stops is read at a glance, and a quiet tint
 * says "food" or "sight" without outweighing the stop's name. Every class is
 * written whole so Tailwind can see it.
 */
const CATEGORY_TILES: Record<TrovePlaceCategory, string> = {
  destination: 'bg-brand/12 text-brand',
  food_and_drink: 'bg-category-food/14 text-category-food',
  other: 'bg-category-other/16 text-category-other',
  shopping: 'bg-category-shopping/14 text-category-shopping',
  stay: 'bg-category-stay/14 text-category-stay',
  things_to_do: 'bg-category-activities/16 text-category-activities',
  transport: 'bg-category-transport/14 text-category-transport',
};

const nameClassName =
  'rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 after:rounded-[var(--radius-xl)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40';

function StopHoursLine({
  item,
  status,
}: Readonly<{ item: ItineraryItem; status: PlaceHoursStatus | undefined }>) {
  const t = useTranslations('itinerary.planner.stop');
  const signalsT = useTranslations('placeSignals');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const at = stopHoursAt(status, item.localStartTime, itineraryLocalEndTime(item));
  // With no planned time to hold the hours against, the day's hours still say something.
  if (!at || !status) return <PlaceHoursNote className="mt-1" status={status} />;

  const clock = (time: string) =>
    time === '24:00'
      ? t('midnight')
      : formatSuggestedClock(time, locale, preferences.timeFormat === '12h');
  const warning =
    at.kind === 'closed_day' || at.kind === 'closed_at' || at.kind === 'closes_during';
  const text =
    at.kind === 'closed_day'
      ? signalsT('closed')
      : at.kind === 'closed_at'
        ? at.opens
          ? t('closedAtOpens', { opens: clock(at.opens), time: clock(item.localStartTime ?? '') })
          : t('closedAt', { time: clock(item.localStartTime ?? '') })
        : at.kind === 'closes_during'
          ? t('closesDuring', { close: clock(at.close) })
          : at.kind === 'open_all_day'
            ? signalsT('allDay')
            : t('openUntil', { close: clock(at.close) });
  const checked = signalsT('checked', {
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
      new Date(status.asOf),
    ),
  });

  return (
    <p
      className={cn(
        'mt-1 text-xs leading-5',
        warning ? 'font-medium text-status-warning' : 'text-muted-foreground',
      )}
    >
      {status.status === 'open' && status.special ? `${t('specialHours')} · ` : null}
      {text}
      <span className="font-normal text-muted-foreground"> · {checked}</span>
    </p>
  );
}

/**
 * A stop, as a card on the day's spine.
 *
 * The number on the spine is the one the map draws, so a pin and a card are
 * matched at a glance; pressing it shows the pin. The card says what the stop
 * is (its category's glyph and its name), when (its time or part of the day),
 * for how long - marked approximate when the AI estimated it - and whether the
 * place is open then, from hours Trove already holds. Anything worth a look
 * about this stop sits under it rather than in a list elsewhere.
 *
 * The name stretches its hit area over the card, so a tap anywhere on it opens
 * the place; the menu and the number sit above that claim.
 */
export function StopCard({
  above,
  attention,
  below,
  defaultTimeZone,
  hours,
  item,
  menu,
  number,
  onSelectOnMap,
  onViewDetails,
  view,
}: Readonly<{
  above: SpineLine;
  /** Notes worth a look about this stop. */
  attention?: ReactNode;
  below: SpineLine;
  defaultTimeZone: string;
  hours: PlaceHoursStatus | undefined;
  item: ItineraryItem;
  menu: ReactNode;
  number: number;
  onSelectOnMap: () => void;
  onViewDetails: () => void;
  view: StopView;
}>) {
  const t = useTranslations('itinerary');
  const plannerT = useTranslations('itinerary.planner.stop');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const category = (item.tripPlace ? view.category : undefined) ?? 'other';
  const { Icon } = resolvePlaceCategoryFallback(category);
  // An end the traveller set is a range; a length is said as one, so an end the
  // AI only estimated is never dressed up as a fixed time.
  const time = formatItineraryTimeRange(
    item.localEndTime ? item : { ...item, durationMinutes: null, localEndTime: null },
    locale,
    preferences.timeFormat,
  );
  const priority = item.tripPlace?.priority ?? item.priority;
  const when = item.localStartTime
    ? item.timeZone && item.timeZone !== defaultTimeZone
      ? t('exactTimeWithTimeZone', { time: time ?? item.localStartTime, timeZone: item.timeZone })
      : (time ?? item.localStartTime)
    : item.dayPart
      ? t(`schedule.${item.dayPart}`)
      : null;
  const duration =
    item.durationMinutes && !item.localEndTime
      ? plannerT(item.durationProvenance === 'ai_estimated' ? 'durationApproximate' : 'duration', {
          value: formatTravelDuration(item.durationMinutes * 60, locale),
        })
      : null;
  const facts = [
    when,
    duration,
    view.locality ?? item.customLocation?.label ?? null,
    item.plannedCost
      ? t('costValue', { amount: item.plannedCost.amount, currency: item.plannedCost.currencyCode })
      : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <SpineRow
      above={above}
      below={below}
      // Plan Score deep links and the map focus a stop by this id.
      id={`itinerary-item-${item.id}`}
      marker={
        view.located ? (
          <button
            aria-label={plannerT('showOnMap', { number })}
            className={cn(
              'relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums outline-none transition-[box-shadow,transform] duration-[var(--motion-fast)] hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
              view.selected && 'ring-4 ring-ring/35',
            )}
            onClick={onSelectOnMap}
            type="button"
          >
            {number}
          </button>
        ) : (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground tabular-nums"
            title={plannerT('noLocation')}
          >
            <span className="sr-only">{t('stopNumber', { number })}</span>
            <span aria-hidden="true">{number}</span>
          </span>
        )
      }
      tabIndex={-1}
    >
      <article
        className={cn(
          'relative my-1.5 rounded-[var(--radius-xl)] border bg-card p-3 transition-[border-color,box-shadow,background-color] duration-[var(--motion-standard)] motion-reduce:transition-none',
          view.selected
            ? 'border-primary/45 bg-secondary/45 shadow-[var(--shadow-card)]'
            : 'border-border-subtle hover:border-border',
          item.travelStatus === 'skipped' && 'opacity-70',
        )}
        data-selected={view.selected || undefined}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)]',
              CATEGORY_TILES[category],
            )}
          >
            <Icon className="size-[1.125rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base leading-snug font-semibold tracking-[-0.01em] text-foreground">
              {view.detailed ? (
                <button
                  aria-label={t('viewDetailsFor', { name: view.name })}
                  className={nameClassName}
                  onClick={onViewDetails}
                  type="button"
                >
                  {view.name}
                </button>
              ) : (
                view.name
              )}
            </h3>
            {facts.length || priority === 'must_go' ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted-foreground tabular-nums">
                {priority === 'must_go' ? (
                  <span className="inline-flex items-center gap-1 font-medium text-brand">
                    <Icons.MustGo aria-hidden="true" className="size-3.5" />
                    {t('priority.must_go')}
                  </span>
                ) : null}
                {facts.map((fact, index) => (
                  <span className="inline-flex items-center gap-1.5" key={`${fact}-${index}`}>
                    {index || priority === 'must_go' ? (
                      <span aria-hidden="true" className="text-text-subtle">
                        ·
                      </span>
                    ) : null}
                    {fact}
                  </span>
                ))}
              </p>
            ) : null}
            <StopHoursLine item={item} status={hours} />
            {item.notes ? (
              <p className="mt-1 line-clamp-1 text-sm text-text-subtle">{item.notes}</p>
            ) : null}
          </div>
          <div className="relative z-10 -mt-1 -mr-1">{menu}</div>
        </div>
        {attention ? <div className="relative z-10 mt-2.5 space-y-2">{attention}</div> : null}
      </article>
    </SpineRow>
  );
}
