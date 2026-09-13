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
 * Below this, the rest of today is not worth calling a forecast on its own, and
 * the strip carries on into tomorrow morning instead.
 *
 * At twenty to eleven at night the useful question is no longer whether it will
 * rain before bed. It is whether tomorrow needs a coat.
 */
const ROLLOVER_BELOW = 3;

/** How many cells the strip aims for once it has rolled into the next day. */
const ROLLED_TARGET = 5;

/**
 * The hour the traveller is standing in, as `2026-09-11T15`.
 *
 * Fixed width and lexicographically ordered, so the comparisons below never
 * have to parse a provider timestamp back into a `Date` and guess at its zone.
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
 * The hours worth showing for `date`, thinned to every other one.
 *
 * Two shapes, because two questions are being asked. On the day the traveller
 * is living, the answer starts at the hour they are standing in - a strip that
 * still said nine in the evening would be reporting a morning that is over. On
 * any other day of the trip the whole day is ahead of them, so the whole day is
 * shown, in the same rhythm so the component does not change shape as they move
 * along the day strip.
 *
 * Late in the evening the first shape runs out, and rather than thin the strip
 * to one lonely cell it carries on into tomorrow morning. Callers can tell where
 * that happened because the returned times say so.
 *
 * The thinning happens here rather than on the server because the answer is
 * cached: a list the API had already trimmed to "from nine" would still say nine
 * at six in the evening.
 */
export function selectHourlyReadings(
  hours: readonly WeatherHourlyForecast[],
  { date, now = new Date(), stepHours = HOURLY_STEP_HOURS, timeZone }: HourlySelection,
): WeatherHourlyForecast[] {
  const step = Math.max(1, Math.trunc(stepHours));
  const from = localHourKey(now, timeZone);
  const today = from.slice(0, 10);

  // A day the traveller is not in yet is read whole; the day they are in starts
  // where they are.
  if (date !== today) {
    return hours
      .filter((hour) => hour.time.startsWith(`${date}T`))
      .filter((_, index) => index % step === 0);
  }

  const ahead = hours.filter((hour) => hour.time.slice(0, 13) >= from);
  const restOfToday = ahead
    .filter((hour) => hour.time.startsWith(`${date}T`))
    .filter((_, index) => index % step === 0);

  if (restOfToday.length >= ROLLOVER_BELOW) return restOfToday;

  return ahead.filter((_, index) => index % step === 0).slice(0, ROLLED_TARGET);
}
