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
