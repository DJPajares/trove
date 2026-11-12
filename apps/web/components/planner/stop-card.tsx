'use client';
import { useTripReadOnly } from '@/components/trip-provider';

import { Clock3 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, type CSSProperties, type ReactNode, type Ref } from 'react';

import { ExpandableDescription } from '@/components/expandable-description';
import { MediaFrame } from '@/components/media-frame';
import { usePreferences } from '@/components/preferences-provider';
import type { ItineraryItem, PlaceHoursStatus } from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { formatItineraryTimeRange, itineraryLocalEndTime } from '@/lib/itinerary/item-timing';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { stopHoursAt } from '@/lib/itinerary/stop-hours';
import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
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
  photo?: EditorialImageReference | null;
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
  'max-w-full rounded-[var(--radius-sm)] text-left break-words outline-none after:absolute after:inset-0 after:rounded-[var(--radius-xl)] hover:underline focus-visible:ring-3 focus-visible:ring-ring/40';

/** The chip shape every fact on a stop shares; each kind brings its own tint. */
const chipClassName =
  'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-5 tabular-nums';

function StopHoursChip({
  item,
  status,
}: Readonly<{ item: ItineraryItem; status: PlaceHoursStatus | undefined }>) {
  const t = useTranslations('itinerary.planner.stop');
  const signalsT = useTranslations('placeSignals');
  const locale = useLocale();
  const { preferences } = usePreferences();
  if (!status) return null;
  const at = stopHoursAt(status, item.localStartTime, itineraryLocalEndTime(item));

  const clock = (time: string) =>
    time === '24:00'
      ? t('midnight')
      : formatSuggestedClock(time, locale, preferences.timeFormat === '12h');
  const span = (open: string, close: string) =>
    t('hoursSpan', { close: clock(close), open: clock(open) });
  // Only what is wrong with the plan gets words; a place that is simply open
  // shows its hours and nothing else, behind a clock that says what they are.
  const warning =
    at?.kind === 'closed_day' || at?.kind === 'closed_at' || at?.kind === 'closes_during';
  const text = !at
    ? // No planned time to hold the hours against: the day's hours, as they are.
      status.status === 'closed'
      ? signalsT('closed')
      : status.spans.length === 1 &&
          status.spans[0]?.open === '00:00' &&
          status.spans[0].close === '24:00'
        ? signalsT('allDay')
        : status.spans.map((hours) => span(hours.open, hours.close)).join(', ')
    : at.kind === 'closed_day'
      ? signalsT('closed')
      : at.kind === 'closed_at'
        ? at.opens
          ? t('closedAtOpens', { opens: clock(at.opens), time: clock(item.localStartTime ?? '') })
          : t('closedAt', { time: clock(item.localStartTime ?? '') })
        : at.kind === 'closes_during'
          ? t('closesDuring', { close: clock(at.close) })
          : at.kind === 'open_all_day'
            ? signalsT('allDay')
            : span(at.open, at.close);
  const closed = warning || status.status === 'closed';
  return (
    <span
      className={cn(
        chipClassName,
        // Outlined, where the plan's own chips are filled: the hours are a
        // fact about the place, not something the traveller set. They turn
        // amber when they are a problem for the plan.
        'border',
        closed
          ? 'border-status-warning/40 bg-status-warning/10 font-medium text-status-warning'
          : 'border-border text-muted-foreground',
        'group-data-[reordering]/day:hidden',
      )}
      data-slot="stop-hours"
      // Date-specific hours are still worth knowing, just not worth a label.
      title={status.status === 'open' && status.special ? t('specialHours') : undefined}
    >
      <Clock3 aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">{t('hoursLabel')}</span>
      <span className="min-w-0 truncate">{text}</span>
    </span>
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
  dragHandle,
  hours,
  item,
  menu,
  number,
  onEditTiming,
  onSelectOnMap,
  onViewDetails,
  partial,
  placeholder = false,
  rowRef,
  rowStyle,
  view,
}: Readonly<{
  above: SpineLine;
  /** Notes worth a look about this stop. */
  attention?: ReactNode;
  below: SpineLine;
  /** The grip a stop is dragged by, when the day can be reordered. */
  dragHandle?: ReactNode;
  hours: PlaceHoursStatus | undefined;
  item: ItineraryItem;
  menu: ReactNode;
  number: number;
  /** Opens the stop's timing on its own - the edit made most often. */
  onEditTiming?: () => void;
  onSelectOnMap: () => void;
  onViewDetails: () => void;
  /** What the stop is missing that one tap can add - a location, a Place. */
  partial?: { label: string; onAction: () => void } | null;
  /** This stop is the one being dragged: what stays behind is where it came from. */
  placeholder?: boolean;
  rowRef?: Ref<HTMLLIElement>;
  rowStyle?: CSSProperties;
  view: StopView;
}>) {
  const t = useTranslations('itinerary');
  const readOnly = useTripReadOnly();
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
    ? (time ?? item.localStartTime)
    : item.dayPart
      ? t(`schedule.${item.dayPart}`)
      : null;
  const duration =
    item.durationMinutes && !item.localEndTime
      ? plannerT(
          ['ai_estimated', 'app_estimated'].includes(item.durationProvenance ?? '')
            ? 'durationApproximate'
            : 'duration',
          {
            value: formatTravelDuration(item.durationMinutes * 60, locale),
          },
        )
      : null;
  const timingParts = [when, duration].filter((fact): fact is string => Boolean(fact));
  const timing = timingParts.join(' · ');
  // Keep time parts together when space permits, but let enlarged text reflow.
  // When the stop happens is the second thing read after its name, so it is
  // the one part of the line set in full colour; how long follows quietly.
  const timingText = timingParts.map((part, index) => (
    <Fragment key={`${part}-${index}`}>
      {index ? ' ' : null}
      <span
        className={cn(
          'whitespace-nowrap',
          index === 0 && when ? 'font-semibold' : 'font-normal opacity-75',
        )}
      >
        {part}
        {index < timingParts.length - 1 ? <span className="opacity-75"> ·</span> : null}
      </span>
    </Fragment>
  ));
  const facts = [
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
      ref={rowRef}
      style={rowStyle}
      tabIndex={-1}
    >
      <article
        className={cn(
          '@container relative my-1.5 rounded-[var(--radius-xl)] border bg-card p-3 transition-[border-color,box-shadow,background-color] duration-[var(--motion-standard)] motion-reduce:transition-none',
          view.selected
            ? 'border-primary/45 bg-secondary/45 shadow-[var(--shadow-card)]'
            : 'border-border-subtle hover:border-border',
          item.travelStatus === 'skipped' && 'opacity-70',
          placeholder && 'border-dashed opacity-40',
        )}
        data-selected={view.selected || undefined}
      >
        {/* Two columns: the photo with the grip beneath it, and the stop's
            words as one stack. Every block in the stack is the same 8px apart,
            and each kind of detail has a form of its own - the name in bold,
            the facts as tinted chips, the notes as plain prose - so they are
            told apart by shape, not by shades of grey. */}
        <div className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-x-3">
          {/* The grip sits under the photo, at the card's lower left: away from
              the menu and the name, where a thumb reaching for either, or a
              finger scrolling past, does not land on it by accident. */}
          <div className="flex flex-col items-center gap-2 self-stretch">
            <MediaFrame
              alt=""
              className={cn('size-[48px] rounded-[var(--radius-md)]', CATEGORY_TILES[category])}
              dataSlot="planner-stop-photo"
              fallbackContent={
                <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
                  <Icon className="size-[1.125rem]" />
                </span>
              }
              sizes="48px"
              source={
                view.photo ? { kind: 'editorial', reference: view.photo } : { kind: 'fallback' }
              }
              variant="thumbnail"
            />
            {dragHandle ? <div className="relative z-10 mt-auto">{dragHandle}</div> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="min-w-0 text-base leading-snug font-semibold tracking-[-0.01em] break-words text-foreground">
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
            {timing || facts.length || priority === 'must_go' || onEditTiming || hours ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {priority === 'must_go' ? (
                  <span className={cn(chipClassName, 'bg-brand/12 font-medium text-brand')}>
                    <Icons.MustGo aria-hidden="true" className="size-3 shrink-0" />
                    {t('priority.must_go')}
                  </span>
                ) : null}
                {/* The time is the part of a stop changed most, so its chip opens
                    its own sheet - above the claim the name makes on the card. */}
                {onEditTiming ? (
                  <button
                    aria-label={
                      timing
                        ? plannerT('changeTiming', { name: view.name, timing })
                        : plannerT('addTimingFor', { name: view.name })
                    }
                    className={cn(
                      chipClassName,
                      'relative z-10 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none',
                      timing
                        ? 'bg-secondary text-secondary-foreground hover:bg-secondary/75'
                        : 'border border-dashed border-primary/40 font-medium text-primary hover:bg-primary/5',
                    )}
                    disabled={readOnly}
                    onClick={onEditTiming}
                    type="button"
                  >
                    {timing ? (
                      timingText
                    ) : (
                      <>
                        <Clock3 aria-hidden="true" className="size-3 shrink-0" />
                        {plannerT('addTiming')}
                      </>
                    )}
                  </button>
                ) : timing ? (
                  <span className={cn(chipClassName, 'bg-secondary text-secondary-foreground')}>
                    {timingText}
                  </span>
                ) : null}
                <StopHoursChip item={item} status={hours} />
                {/* Where and how much are plain words beside the chips: worth
                    knowing, never worth a shape of their own. */}
                {facts.map((fact, index) => (
                  <span
                    className="max-w-full text-xs leading-5 break-words text-muted-foreground"
                    key={`${fact}-${index}`}
                  >
                    {fact}
                  </span>
                ))}
              </div>
            ) : null}
            {partial ? (
              <button
                className="relative z-10 inline-flex items-center gap-1 self-start rounded-[var(--radius-sm)] text-sm font-medium text-primary outline-none group-data-[reordering]/day:hidden hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={partial.onAction}
                type="button"
              >
                <Icons.Place aria-hidden="true" className="size-3.5" />
                {partial.label}
              </button>
            ) : null}
            {item.notes ? (
              // Words to read rather than facts to scan: plain body text with
              // looser lines, the one block on the card with no shape around it.
              <ExpandableDescription
                className="text-sm leading-relaxed text-foreground/80 group-data-[reordering]/day:hidden"
                name={view.name}
                text={item.notes}
              />
            ) : null}
          </div>
          <div className="relative z-10 -mt-1 -mr-1 flex items-center">
            <span className="group-data-[reordering]/day:invisible">{menu}</span>
          </div>
        </div>
        {attention ? (
          // Every warning on the stop, stacked flush into one compact strip at
          // its foot: still clearly a warning, never heavier than the stop.
          // Each keeps its own tint, so a conflict still reads red beside an
          // advisory's amber. The notes themselves stay full size elsewhere.
          <div
            className="relative z-10 mt-3 flex flex-col group-data-[reordering]/day:hidden [&>[data-slot=attention-note]]:rounded-none [&>[data-slot=attention-note]]:py-1.5 [&>[data-slot=attention-note]]:text-[0.8125rem] [&>[data-slot=attention-note]:first-child]:rounded-t-[var(--radius-md)] [&>[data-slot=attention-note]:last-child]:rounded-b-[var(--radius-md)] [&_[data-slot=attention-actions]]:mt-0.5"
            data-slot="stop-attention"
          >
            {attention}
          </div>
        ) : null}
      </article>
    </SpineRow>
  );
}
