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

import { InsertGap } from './insert-gap';
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
  onInsert,
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
  /** Adds a stop at `position` among the day's stops, after the stop named `afterName`. */
  onInsert: (position: number, afterName: string | null) => void;
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
  const insertT = useTranslations('itinerary.planner.insert');

  // Where a new stop can go: before each stop, and after the last. The "+" sits
  // on the leg that reaches that spot when one is drawn, and in a gap of its own
  // when not - the day's first stop before its legs arrive, or Compact view.
  const stops = entries.flatMap((entry) => (entry.kind === 'stop' ? [entry.item] : []));
  const stopIndex = new Map(stops.map((item, index) => [item.id, index]));
  const names = stops.map((item) => resolveItem(item).name);
  const legInto = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'leg' && entry.segment.destination.kind === 'itinerary_item'
        ? [entry.segment.destination.id]
        : [],
    ),
  );
  const returnsToStay = entries.some(
    (entry) => entry.kind === 'leg' && entry.segment.destination.kind === 'daily_base',
  );
  const insertBefore = (index: number) => ({
    label: insertT('before', { name: names[index] ?? '' }),
    onInsert: () => onInsert(index, index > 0 ? (names[index - 1] ?? null) : null),
  });
  const insertAtEnd = {
    label: insertT('end'),
    onInsert: () => onInsert(stops.length, names.at(-1) ?? null),
  };

  const rows: ReactNode[] = [];
  let endOffered = false;
  entries.forEach((entry, index) => {
    const above = lineBetween(entries[index - 1], entry);
    const below = lineBetween(entry, entries[index + 1]);

    if (entry.kind === 'band') {
      rows.push(
        <SpineRow above={above} align="center" below={below} key={`band-${entry.band}-${index}`}>
          <p className="pt-3 pb-1 text-[length:var(--text-metadata)] font-semibold tracking-[0.14em] text-brand uppercase">
            {t(`schedule.${entry.band}`)}
          </p>
        </SpineRow>,
      );
      return;
    }

    if (entry.kind === 'leg') {
      const destination = entry.segment.destination;
      const into =
        destination.kind === 'itinerary_item' ? stopIndex.get(destination.id) : undefined;
      const insert =
        into !== undefined
          ? insertBefore(into)
          : destination.kind === 'daily_base' && stops.length
            ? insertAtEnd
            : undefined;
      if (insert === insertAtEnd) endOffered = true;
      rows.push(
        <LegConnector
          distanceUnit={distanceUnit}
          insert={insert}
          key={`leg-${entry.segment.id}`}
          onModeChange={onModeChange}
          saving={
            savingRouteOwner === `${entry.segment.modeOwner.kind}:${entry.segment.modeOwner.id}`
          }
          segment={entry.segment}
          stale={routesStale}
        />,
      );
      return;
    }

    if (entry.kind === 'base') {
      if (entry.role === 'departure' && stops.length && !returnsToStay && !endOffered) {
        endOffered = true;
        rows.push(<InsertGap above={above} key="insert-end" {...insertAtEnd} />);
      }
      const base = resolveBase(entry.tripPlaceId);
      if (!base) return;
      rows.push(
        <StayAnchor
          key={`stay-${entry.role}`}
          located={base.located}
          name={base.name}
          number={entry.stopNumber}
          onSelectOnMap={() => onSelectBase(entry.tripPlaceId)}
          onViewDetails={() => onViewBaseDetails(entry.tripPlaceId)}
          role={entry.role}
          selected={base.selected}
        />,
      );
      return;
    }

    const { item } = entry;
    const position = stopIndex.get(item.id) ?? 0;
    const view = resolveItem(item);
    if (!legInto.has(item.id)) {
      rows.push(<InsertGap above={above} key={`insert-${item.id}`} {...insertBefore(position)} />);
    }
    rows.push(
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
            index={position}
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
      />,
    );
  });
  if (stops.length && !endOffered) {
    // The day ends at its last stop, so this "+" stands on its own below it.
    rows.push(<InsertGap above="none" key="insert-end" {...insertAtEnd} />);
  }

  return (
    <ol aria-label={label} className="flex flex-col" data-slot="day-timeline">
      {rows}
    </ol>
  );
}
