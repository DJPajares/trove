import { planningTime } from './planning-clock.js';
import { scoringOpeningHours, type ScoringHours } from './plan-score-normalization.js';

/**
 * What stored opening hours say about one calendar date, in words a card can
 * show. Derived with the same date-aware rules Plan Score uses, from evidence
 * that is already stored: it never reaches a provider.
 */
export type PlaceHoursStatus =
  | { status: 'unknown' }
  | { status: 'closed'; asOf: string }
  | {
      status: 'open';
      asOf: string;
      /** The day's opening spans, day-local `HH:MM`. A span past midnight ends at `24:00`. */
      spans: Array<{ close: string; open: string }>;
      /** These are the date-specific hours Google published for the day, not the weekly pattern. */
      special: boolean;
    };

export function placeHoursStatus(input: { date: string; hours: ScoringHours }): PlaceHoursStatus {
  const { date, hours } = input;
  const asOf = hours.fetchedAt;
  if (!asOf) return { status: 'unknown' };

  const opening = scoringOpeningHours({ date, hours });
  if (opening.status !== 'KNOWN') return { status: 'unknown' };
  const length = 1440;
  const spans = opening.intervals.flatMap((interval) => {
    const start = Math.max(0, interval.startMinute);
    const end = Math.min(length, interval.endMinute);
    return end > start ? [{ end, start }] : [];
  });
  if (!spans.length) return { asOf, status: 'closed' };

  const clock = (minute: number) => (minute >= length ? '24:00' : planningTime(minute));
  const special = Boolean(
    hours.currentPeriods?.length &&
    hours.validFrom &&
    hours.validThrough &&
    date >= hours.validFrom &&
    date <= hours.validThrough,
  );

  return {
    asOf,
    special,
    spans: spans.map((span) => ({ close: clock(span.end), open: clock(span.start) })),
    status: 'open',
  };
}
