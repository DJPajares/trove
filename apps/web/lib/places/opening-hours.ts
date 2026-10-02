const MINUTE_MS = 60 * 1000;

/**
 * Which of Google's weekly hours lines is "today" at the place itself.
 *
 * Google lists `weekdayDescriptions` Monday first, and the place's day is the
 * one that matters - a traveller planning from another time zone would
 * otherwise see tomorrow's hours as today's. Without an offset there is no
 * honest answer, so nothing is highlighted rather than the device's day.
 */
export function placeWeekdayIndex(
  utcOffsetMinutes: number | null | undefined,
  now: Date = new Date(),
): number | null {
  if (typeof utcOffsetMinutes !== 'number' || !Number.isFinite(utcOffsetMinutes)) return null;
  const sundayFirst = new Date(now.getTime() + utcOffsetMinutes * MINUTE_MS).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** A visit date is already local; applying a timezone offset would shift its weekday. */
export function visitWeekdayIndex(
  visitDate: string | null | undefined,
  utcOffsetMinutes: number | null | undefined,
  now: Date = new Date(),
): number | null {
  if (visitDate === undefined) return placeWeekdayIndex(utcOffsetMinutes, now);
  if (visitDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return null;
  const date = new Date(`${visitDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== visitDate)
    return null;
  return (date.getUTCDay() + 6) % 7;
}
