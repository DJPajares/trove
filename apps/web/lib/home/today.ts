import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';

/** How many of today's stops Home shows. Trip Mode's Today view holds the whole day. */
export const HOME_TODAY_LIMIT = 4;

export type TodayRowState = 'current' | 'done' | 'next' | 'skipped' | 'upcoming';

export type TodayRow = { item: ItineraryItem; state: TodayRowState };

export type TodaySummary = {
  /** Stops before the first one shown - already done or passed over. */
  earlier: number;
  /** Stops after the last one shown. */
  later: number;
  rows: TodayRow[];
  /** Every stop on the day, so "all done" can be told from "nothing planned". */
  total: number;
};

function rowState(item: ItineraryItem, context: TripModeContext): TodayRowState {
  if (item.travelStatus === 'completed') return 'done';
  if (item.travelStatus === 'skipped') return 'skipped';
  if (item.id === context.currentOrRelevant?.itemId && context.currentOrRelevant.kind === 'current')
    return 'current';
  if (item.id === context.nextItemId) return 'next';
  return 'upcoming';
}

/**
 * The part of today Home shows: from where the traveller is in their day,
 * onwards, a few stops at a time.
 *
 * Everything here is read from the Trip Mode context Home already holds for
 * the trip under way - which stop is current and which is next are the
 * server's answers, never re-derived here, so Home and Trip Mode can never
 * disagree about where the day stands.
 */
export function summarizeToday(
  context: TripModeContext | null,
  limit = HOME_TODAY_LIMIT,
): TodaySummary | null {
  if (!context?.day) return null;

  const items = context.day.items.toSorted((left, right) => left.position - right.position);
  const rows = items.map((item) => ({ item, state: rowState(item, context) }));
  const anchorOf = (state: TodayRowState) => rows.findIndex((row) => row.state === state);
  const firstOpen = rows.findIndex((row) => row.state !== 'done' && row.state !== 'skipped');
  const anchor = [anchorOf('current'), anchorOf('next'), firstOpen].find((index) => index >= 0);

  if (anchor === undefined) return { earlier: rows.length, later: 0, rows: [], total: rows.length };

  const shown = rows.slice(anchor, anchor + limit);

  return {
    earlier: anchor,
    later: rows.length - anchor - shown.length,
    rows: shown,
    total: rows.length,
  };
}
