import type { WeatherHourlyForecast } from '@/lib/weather/api';

/**
 * Two hours is the step a day is actually read at.
 *
 * Every hour is a wall of numbers on a screen meant to be glanced at standing
 * up; every three loses the hour the rain starts. Two keeps the shape of an
 * afternoon while still fitting a day into a handful of cells.
 */
export const HOURLY_STEP_HOURS = 2;

/**
 * The hour the traveller is standing in, as `2026-09-11T15`.
 *
 * Fixed width and lexicographically ordered, so the comparison below never has
 * to parse a provider timestamp back into a `Date` and guess at its zone.
 */
function localHourKey(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}T${values.hour}`;
}

export type HourlySelection = {
  date: string;
  now?: Date;
  stepHours?: number;
  timeZone: string;
};

/**
 * The hours of `date` still ahead of the traveller, thinned to every other one.
 *
 * The filtering happens here rather than on the server because the answer is
 * cached for a day: a list the API had already trimmed to "from nine" would
 * still say nine at six in the evening. The provider's window also runs past
 * midnight into tomorrow, and those hours belong to a different day of the
 * trip, so they are dropped rather than shown under today's heading.
 */
export function selectHourlyReadings(
  hours: readonly WeatherHourlyForecast[],
  { date, now = new Date(), stepHours = HOURLY_STEP_HOURS, timeZone }: HourlySelection,
): WeatherHourlyForecast[] {
  const step = Math.max(1, Math.trunc(stepHours));
  const from = localHourKey(now, timeZone);

  return hours
    .filter((hour) => hour.time.startsWith(`${date}T`) && hour.time.slice(0, 13) >= from)
    .filter((_, index) => index % step === 0);
}
