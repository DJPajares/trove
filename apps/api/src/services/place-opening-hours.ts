import type { PlaceOpeningPeriod } from './places.js';
import type { PlanScoreInterval, PlanScoreOpeningHours } from './plan-score-factors.js';

/**
 * Turns a provider's weekly opening periods into the interval shape Plan Score's
 * feasibility rubric already understands (PRD section 29.1).
 *
 * Google reports hours as a weekly cycle in the place's own local time, with
 * `day` 0 = Sunday. Everything here is pure and works in minutes from local
 * midnight; `endMinute` may exceed 1440 for a period that runs past midnight,
 * which `PlanScoreInterval` explicitly allows.
 */

const MINUTES_PER_DAY = 1440;

/** Weekday for a `YYYY-MM-DD` local date, 0 = Sunday. */
export function weekdayForLocalDate(date: string): number {
  // Parsing at UTC midnight keeps this independent of the host timezone: the
  // date string already carries the day the traveller means.
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function openMinutes(point: { hour: number; minute: number }) {
  return point.hour * 60 + point.minute;
}

/**
 * Intervals covering `weekday`, including the tail of a period that opened the
 * previous day. A period with no close is treated as always open, which is how
 * Google represents a 24/7 place: one open point and nothing else.
 */
export function openingIntervalsForWeekday(
  periods: PlaceOpeningPeriod[],
  weekday: number,
): PlanScoreInterval[] {
  const intervals: PlanScoreInterval[] = [];
  const previousWeekday = (weekday + 6) % 7;

  for (const period of periods) {
    // An open point with no close means the place never shuts, so it covers
    // every weekday rather than only the one the period is filed under.
    if (period.close === null) {
      intervals.push({ endMinute: MINUTES_PER_DAY, startMinute: 0 });
      continue;
    }

    const closeMinute = openMinutes(period.close);

    if (period.open.day === weekday) {
      // A close on a later day runs past midnight; endMinute stays above 1440 so
      // the visit can be measured against the whole span.
      const wraps = period.close.day !== period.open.day;
      intervals.push({
        endMinute: wraps ? closeMinute + MINUTES_PER_DAY : closeMinute,
        startMinute: openMinutes(period.open),
      });
      continue;
    }

    // Spillover: yesterday's late period still has this morning open.
    if (period.close.day === weekday && period.open.day === previousWeekday) {
      intervals.push({ endMinute: closeMinute, startMinute: 0 });
    }
  }

  return intervals;
}

/**
 * Opening evidence for one itinerary day.
 *
 * Returns `UNKNOWN` only when the hours genuinely cannot be trusted. A weekday
 * with no period is *not* unknown: when the provider supplied a weekly schedule
 * at all, a missing weekday means the place is shut that day, which is exactly
 * the conflict this evidence exists to surface. That case returns `KNOWN` with
 * no intervals, which `openingHoursSeverity` already scores as a hard conflict.
 */
export function resolveOpeningHoursForDay(input: {
  date: string;
  dayTimeZone: string;
  periods: PlaceOpeningPeriod[];
  utcOffsetMinutes: number | null;
}): PlanScoreOpeningHours {
  if (input.periods.length === 0 || input.utcOffsetMinutes === null) {
    return { status: 'UNKNOWN' };
  }

  // The periods are stated in the place's local time, but the rubric compares
  // them against item start times expressed in the day's timezone. Those only
  // line up when the place actually sits in that timezone.
  //
  // Both offsets are read at the same instant deliberately. Comparing the
  // place's current offset against the day timezone's offset on the itinerary
  // date would differ whenever the trip crosses a DST boundary relative to
  // today, and would reject most plans made months ahead. Comparing like with
  // like answers the question that matters -- same zone or not -- and once the
  // answer is yes the periods are day-local for any date in that zone.
  if (timeZoneOffsetMinutes(input.dayTimeZone, new Date()) !== input.utcOffsetMinutes) {
    return { status: 'UNKNOWN' };
  }

  return {
    intervals: openingIntervalsForWeekday(input.periods, weekdayForLocalDate(input.date)),
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes east of UTC. */
function timeZoneOffsetMinutes(timeZone: string, instant: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(instant);
    const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    // `hour` can format as 24 for midnight under hour12: false.
    const hour = field('hour') % 24;
    const asUtc = Date.UTC(
      field('year'),
      field('month') - 1,
      field('day'),
      hour,
      field('minute'),
      field('second'),
    );

    // Truncate to whole seconds to match the formatted parts, without mutating
    // the caller's Date.
    const base = Math.floor(instant.getTime() / 1000) * 1000;

    return Math.round((asUtc - base) / 60_000);
  } catch {
    return null;
  }
}
