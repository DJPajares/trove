'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type {
  ItineraryItem,
  ItineraryRouteSegment,
  PlaceHoursStatus,
  RouteTravelMode,
} from '@/lib/itinerary/api';
import type { BandedEntry } from '@/lib/itinerary/day-bands';

import { LegConnector } from './leg-connector';
import { SpineRow, type SpineLine } from './spine';
import { StayAnchor } from './stay-anchor';
import { StopCard, type StopView } from './stop-card';
import { StopMenu, type StopMenuActions } from './stop-menu';

/** A leg that leaves the Stay in the morning or returns to it at night. */
function isStayLeg(segment: ItineraryRouteSegment) {
  return (
    (segment.modeOwner.kind === 'day_start' && segment.origin.kind === 'daily_base') ||
    segment.destination.kind === 'daily_base'
  );
}

/**
 * How the spine runs between two rows: dashed on the stretch between the Stay
 * and the day, solid between stops, and nothing past either end of the day.
 */
function lineBetween(left: BandedEntry | undefined, right: BandedEntry | undefined): SpineLine {
  if (!left || !right) return 'none';
  const touchesStay = (entry: BandedEntry) =>
    entry.kind === 'base' || (entry.kind === 'leg' && isStayLeg(entry.segment));
  return touchesStay(left) || touchesStay(right) ? 'dashed' : 'solid';
}

/**
 * The day in travel order, on one spine: the Stay it starts from, each stop as
 * a card, the travel between them as the line that joins them, quiet labels
 * where the day moves into its afternoon and evening, and the Stay it ends at.
 *
 * Every row's place comes from the day's sequence and its labels from
 * `withDayPartBands`, never from here: where a row belongs is a fact about the
 * day, and a renderer that decided it would eventually decide differently
 * from the map beside it.
 */
export function DayTimeline({
  attentionFor,
  defaultTimeZone,
  distanceUnit,
  entries,
  hoursFor,
  itemCount,
  label,
  menuActions,
  onModeChange,
  onSelectBase,
  onSelectItem,
  onViewBaseDetails,
  onViewItemDetails,
  resolveBase,
  resolveItem,
  routesStale,
  savingRouteOwner,
}: Readonly<{
  /** What is worth a look about a stop, set under it. */
  attentionFor: (item: ItineraryItem) => ReactNode;
  defaultTimeZone: string;
  distanceUnit: 'km' | 'mi';
  entries: readonly BandedEntry[];
  hoursFor: (item: ItineraryItem) => PlaceHoursStatus | undefined;
  itemCount: number;
  label: string;
  menuActions: StopMenuActions;
  onModeChange: (segment: ItineraryRouteSegment, mode: RouteTravelMode) => void;
  onSelectBase: (tripPlaceId: string) => void;
  onSelectItem: (item: ItineraryItem) => void;
  onViewBaseDetails: (tripPlaceId: string) => void;
  onViewItemDetails: (item: ItineraryItem) => void;
  resolveBase: (
    tripPlaceId: string,
  ) => { located: boolean; name: string; selected: boolean } | null;
  resolveItem: (item: ItineraryItem) => StopView;
  routesStale: boolean;
  savingRouteOwner: string | null;
}>) {
  const t = useTranslations('itinerary');
  let stopIndex = -1;

  return (
    <ol aria-label={label} className="flex flex-col" data-slot="day-timeline">
      {entries.map((entry, index) => {
        const above = lineBetween(entries[index - 1], entry);
        const below = lineBetween(entry, entries[index + 1]);

        if (entry.kind === 'band') {
          return (
            <SpineRow
              above={above}
              align="center"
              below={below}
              key={`band-${entry.band}-${index}`}
            >
              <p className="pt-3 pb-1 text-[length:var(--text-metadata)] font-semibold tracking-[0.14em] text-brand uppercase">
                {t(`schedule.${entry.band}`)}
              </p>
            </SpineRow>
          );
        }

        if (entry.kind === 'leg') {
          return (
            <LegConnector
              distanceUnit={distanceUnit}
              key={`leg-${entry.segment.id}`}
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
            <StayAnchor
              key={`stay-${entry.role}`}
              located={base.located}
              name={base.name}
              number={entry.stopNumber}
              onSelectOnMap={() => onSelectBase(entry.tripPlaceId)}
              onViewDetails={() => onViewBaseDetails(entry.tripPlaceId)}
              role={entry.role}
              selected={base.selected}
            />
          );
        }

        stopIndex += 1;
        const { item } = entry;
        const view = resolveItem(item);

        return (
          <StopCard
            above={above}
            attention={attentionFor(item)}
            below={below}
            defaultTimeZone={defaultTimeZone}
            hours={hoursFor(item)}
            item={item}
            key={item.id}
            menu={
              <StopMenu
                actions={menuActions}
                index={stopIndex}
                item={item}
                itemCount={itemCount}
                located={view.located}
                mapsHref={view.mapsHref}
                name={view.name}
              />
            }
            number={entry.stopNumber}
            onSelectOnMap={() => onSelectItem(item)}
            onViewDetails={() => onViewItemDetails(item)}
            view={view}
          />
        );
      })}
    </ol>
  );
}
