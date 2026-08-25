'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Copy,
  Ellipsis,
  ExternalLink,
  MapPin,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ItineraryRouteSegmentRow } from '@/components/itinerary-route-details';
import { TimelineGroup, TimelineMarker, TimelineRow } from '@/components/timeline-row';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryItem, ItineraryRouteSegment, RouteTravelMode } from '@/lib/itinerary/api';
import type { DayTimelineEntry } from '@/lib/itinerary/day-sequence';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';

/**
 * A stop's name, and the whole row along with it.
 *
 * The name opens the place, but the row is what a traveller aims at - a time, a
 * duration and a note are the same stop, and a tap that landed on one of them
 * used to do nothing at all. The row cannot be the button, because it already
 * holds one, so the name stretches its hit area over the row instead and the
 * actions menu sits above that. Hovering anywhere on the row underlines the
 * name, which is what says the row is a way in.
 */
const stopTitleClassName =
  'rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40';

/** What a stop needs in order to render, resolved by the manager that owns the day. */
export type TimelineStopView = {
  located: boolean;
  mapsHref: string | null;
  name: string;
  selected: boolean;
};

export type ItineraryDayTimelineProps = {
  dayOptions: Array<{ id: string; label: string }>;
  defaultTimeZone: string;
  distanceUnit: 'km' | 'mi';
  entries: DayTimelineEntry[];
  itemCount: number;
  label: string;
  locale: string;
  onDeleteItem: (item: ItineraryItem) => void;
  onDuplicateItem: (item: ItineraryItem) => void;
  onEditItem: (item: ItineraryItem) => void;
  onModeChange: (segment: ItineraryRouteSegment, mode: RouteTravelMode) => void;
  onMoveItem: (item: ItineraryItem, dayId: string | null, position: number) => void;
  onSelectBase: (tripPlaceId: string) => void;
  /** Shows the stop's pin on the map - what clicking the row used to do. */
  onSelectItem: (item: ItineraryItem) => void;
  onViewBaseDetails: (tripPlaceId: string) => void;
  onViewItemDetails: (item: ItineraryItem) => void;
  organizingItemId: string | null;
  resolveBase: (tripPlaceId: string) => Omit<TimelineStopView, 'mapsHref'> | null;
  resolveItem: (item: ItineraryItem) => TimelineStopView;
  routesStale: boolean;
  savingRouteOwner: string | null;
  selectedDayId: string;
  timeFormat: '12h' | '24h';
  unscheduledLabel: string;
};

/**
 * A day, in the order it is travelled.
 *
 * Every row here hangs off one connector — the base the day starts from, each
 * stop, the leg that reaches it, and the base it ends at — so the sequence is
 * something the markup states rather than something the reader reassembles. The
 * running order itself comes from `buildDaySequence`, not from this file: where
 * a row belongs is a fact about the day, and a renderer that decided it would
 * eventually decide differently from the map.
 */
export function ItineraryDayTimeline({
  dayOptions,
  defaultTimeZone,
  distanceUnit,
  entries,
  itemCount,
  label,
  locale,
  onDeleteItem,
  onDuplicateItem,
  onEditItem,
  onModeChange,
  onMoveItem,
  onSelectBase,
  onSelectItem,
  onViewBaseDetails,
  onViewItemDetails,
  organizingItemId,
  resolveBase,
  resolveItem,
  routesStale,
  savingRouteOwner,
  selectedDayId,
  timeFormat,
  unscheduledLabel,
}: Readonly<ItineraryDayTimelineProps>) {
  const t = useTranslations('itinerary');
  let itemIndex = -1;

  return (
    <TimelineGroup label={label}>
      {entries.map((entry, index) => {
        const connector =
          entries.length === 1
            ? 'none'
            : index === 0
              ? 'after'
              : index === entries.length - 1
                ? 'before'
                : 'both';

        if (entry.kind === 'leg') {
          return (
            <ItineraryRouteSegmentRow
              connector={connector}
              distanceUnit={distanceUnit}
              key={`route-${entry.segment.id}`}
              locale={locale}
              onModeChange={onModeChange}
              saving={
                savingRouteOwner === `${entry.segment.modeOwner.kind}:${entry.segment.modeOwner.id}`
              }
              segment={entry.segment}
              stale={routesStale}
            />
          );
        }

        if (entry.kind === 'base') {
          const base = resolveBase(entry.tripPlaceId);
          if (!base) return null;

          return (
            <TimelineRow
              actions={
                // The one thing a base's menu carries. Where a day starts and
                // ends is still changed in day settings rather than here, so
                // this stays a way of looking at the stop, not of editing it -
                // and it is the same gesture the numbered stops offer.
                base.located ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          aria-label={t('itemActions', { name: base.name })}
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                        />
                      }
                    >
                      <Ellipsis aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      <DropdownMenuItem onClick={() => onSelectBase(entry.tripPlaceId)}>
                        <MapPin aria-hidden="true" />
                        {t('itemMenu.showOnMap')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined
              }
              connector={connector}
              description={
                entry.role === 'arrival' ? t('dayBaseStartDescription') : t('dayBaseEndDescription')
              }
              key={`base-${entry.role}`}
              marker={
                <TimelineMarker
                  label={t('stopNumber', { number: entry.stopNumber })}
                  variant={base.located ? 'base' : 'base-unlocated'}
                >
                  {entry.stopNumber}
                </TimelineMarker>
              }
              selected={base.selected}
              title={
                base.located ? (
                  <button
                    aria-label={t('viewDetailsFor', { name: base.name })}
                    className={stopTitleClassName}
                    onClick={() => onViewBaseDetails(entry.tripPlaceId)}
                    type="button"
                  >
                    {base.name}
                  </button>
                ) : (
                  base.name
                )
              }
            />
          );
        }

        const { item } = entry;
        itemIndex += 1;
        const position = itemIndex;
        const view = resolveItem(item);

        return (
          <TimelineRow
            actions={
              // One menu instead of seven controls: the row is content, not a
              // toolbar, and this behaves the same without hover.
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={t('itemActions', { name: view.name })}
                      disabled={organizingItemId === item.id}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem
                    disabled={position === 0}
                    onClick={() => onMoveItem(item, selectedDayId, position - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                    {t('itemMenu.moveEarlier')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={position === itemCount - 1}
                    onClick={() => onMoveItem(item, selectedDayId, position + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                    {t('itemMenu.moveLater')}
                  </DropdownMenuItem>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <CalendarClock aria-hidden="true" />
                      {t('moveToDay')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                      <DropdownMenuRadioGroup
                        onValueChange={(value) =>
                          onMoveItem(item, value === 'unscheduled' ? null : value, 999)
                        }
                        value={selectedDayId}
                      >
                        {dayOptions.map((day) => (
                          <DropdownMenuRadioItem key={day.id} value={day.id}>
                            {day.label}
                          </DropdownMenuRadioItem>
                        ))}
                        <DropdownMenuRadioItem value="unscheduled">
                          {unscheduledLabel}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => onEditItem(item)}>
                    <Pencil aria-hidden="true" />
                    {t('itemMenu.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onDuplicateItem(item)}>
                    <Copy aria-hidden="true" />
                    {t('itemMenu.duplicate')}
                  </DropdownMenuItem>
                  {/* What clicking the row used to do. The row now opens the
                      place, so the map lives here - one deliberate step away
                      rather than the thing every stray tap triggered. */}
                  {view.located ? (
                    <DropdownMenuItem onClick={() => onSelectItem(item)}>
                      <MapPin aria-hidden="true" />
                      {t('itemMenu.showOnMap')}
                    </DropdownMenuItem>
                  ) : null}
                  {view.mapsHref ? (
                    <DropdownMenuLinkItem
                      render={<a href={view.mapsHref} rel="noreferrer" target="_blank" />}
                    >
                      <ExternalLink aria-hidden="true" />
                      {t('itemMenu.openPlace')}
                    </DropdownMenuLinkItem>
                  ) : null}

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => onDeleteItem(item)} variant="destructive">
                    <Trash2 aria-hidden="true" />
                    {t('itemMenu.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            connector={connector}
            description={
              <>
                <span className="flex flex-wrap gap-x-2 gap-y-1">
                  <span>
                    {item.localStartTime
                      ? item.timeZone && item.timeZone !== defaultTimeZone
                        ? t('exactTimeWithTimeZone', {
                            time:
                              formatItineraryTimeRange(item, locale, timeFormat) ??
                              item.localStartTime,
                            timeZone: item.timeZone,
                          })
                        : t('exactTimeValue', {
                            time:
                              formatItineraryTimeRange(item, locale, timeFormat) ??
                              item.localStartTime,
                          })
                      : item.dayPart
                        ? t(`schedule.${item.dayPart}`)
                        : t('schedule.none')}
                  </span>
                  {item.durationMinutes && !item.localStartTime ? (
                    <span>{t('durationValue', { minutes: item.durationMinutes })}</span>
                  ) : null}
                  {item.plannedCost ? (
                    <span>
                      {t('costValue', {
                        amount: item.plannedCost.amount,
                        currency: item.plannedCost.currencyCode,
                      })}
                    </span>
                  ) : null}
                  {item.customLocation ? <span>{item.customLocation.label}</span> : null}
                </span>
                {item.notes ? <span className="mt-1 block line-clamp-2">{item.notes}</span> : null}
              </>
            }
            // Plan Score deep-links focus a stop by this id.
            id={`itinerary-item-${item.id}`}
            key={item.id}
            marker={
              // The same number the map draws in its circle, so a pin and a row
              // can be matched at a glance. An item with no location has no pin
              // to match, and says so by not looking like one.
              <TimelineMarker
                label={t('stopNumber', { number: entry.stopNumber })}
                variant={view.located ? 'stop' : 'stop-unlocated'}
              >
                {entry.stopNumber}
              </TimelineMarker>
            }
            selected={view.selected}
            tabIndex={-1}
            title={
              view.located ? (
                <button
                  aria-label={t('viewDetailsFor', { name: view.name })}
                  className={stopTitleClassName}
                  onClick={() => onViewItemDetails(item)}
                  type="button"
                >
                  {view.name}
                </button>
              ) : (
                view.name
              )
            }
          />
        );
      })}
    </TimelineGroup>
  );
}
