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
      /**
       * Google published date-specific hours for the day that differ from the
       * place's weekly pattern. Its dated hours cover the next week for every
       * place, so having them is not itself special.
       */
      special: boolean;
    };

export function placeHoursStatus(input: { date: string; hours: ScoringHours }): PlaceHoursStatus {
  const { date, hours } = input;
  const asOf = hours.fetchedAt;
  if (!asOf) return { status: 'unknown' };

  const opening = scoringOpeningHours({ date, hours });
  if (opening.status !== 'KNOWN') return { status: 'unknown' };
  const spans = daySpans(opening.intervals);
  if (!spans.length) return { asOf, status: 'closed' };

  const clock = (minute: number) => (minute >= DAY_MINUTES ? '24:00' : planningTime(minute));
  const dated = Boolean(
    hours.currentPeriods?.length &&
    hours.validFrom &&
    hours.validThrough &&
    date >= hours.validFrom &&
    date <= hours.validThrough,
  );
  // Without a weekly pattern there is nothing the day's hours could differ from.
  const weekly = dated ? weeklySpans(date, hours) : null;
  const special = weekly !== null && !sameSpans(spans, weekly);

  return {
    asOf,
    special,
    spans: spans.map((span) => ({ close: clock(span.end), open: clock(span.start) })),
    status: 'open',
  };
}

const DAY_MINUTES = 1440;

type Span = { end: number; start: number };

function daySpans(intervals: ReadonlyArray<{ endMinute: number; startMinute: number }>): Span[] {
  return intervals.flatMap((interval) => {
    const start = Math.max(0, interval.startMinute);
    const end = Math.min(DAY_MINUTES, interval.endMinute);
    return end > start ? [{ end, start }] : [];
  });
}

/** The day's spans from the weekly pattern alone, for comparison with the dated ones. */
function weeklySpans(date: string, hours: ScoringHours): Span[] | null {
  if (!hours.periods.length) return null;
  const weekly = scoringOpeningHours({ date, hours: { ...hours, currentPeriods: undefined } });
  return weekly.status === 'KNOWN' ? daySpans(weekly.intervals) : null;
}

function sameSpans(dated: readonly Span[], weekly: readonly Span[]): boolean {
  return (
    dated.length === weekly.length &&
    dated.every(
      (span, index) => span.start === weekly[index]?.start && span.end === weekly[index]?.end,
    )
  );
}
