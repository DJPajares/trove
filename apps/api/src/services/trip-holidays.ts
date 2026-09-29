import Holidays, { type HolidaysTypes } from 'date-holidays';
import type { TripContextHoliday } from '@trove/types';

/**
 * Public holidays for a trip's days, from the open `date-holidays` dataset
 * (207 countries, bundled with the package). It is read locally, so nothing
 * here makes a network request or costs anything per call.
 */

export type HolidayDay = {
  id: string;
  /** The day's local calendar date. */
  date: string;
  /** The zone the day's plan runs in, which is what places it in a country. */
  timeZone: string | null;
};

/**
 * Islamic holidays follow a sighting of the moon, so the dataset's date can
 * move by a day once it is announced. Every other rule is fixed or computed.
 */
const HIJRI_MONTH =
  /\b(muharram|safar|rabi al-(awwal|thani)|jumada al-(awwal|thani)|rajab|shaban|ramadan|shawwal|dhu al-(qidah|hijjah))\b/i;

let countriesByZone: Map<string, string[]> | undefined;

/** Every country the dataset places in a zone, indexed once on first use. */
function countriesInZone(timeZone: string) {
  if (!countriesByZone) {
    countriesByZone = new Map();
    for (const code of Object.keys(new Holidays().getCountries())) {
      for (const zone of new Holidays(code).getTimezones()) {
        countriesByZone.set(zone, [...(countriesByZone.get(zone) ?? []), code]);
      }
    }
  }
  return countriesByZone.get(timeZone) ?? [];
}

/**
 * The one country a day is in, or null when that cannot be told. A zone that
 * several countries share (Vietnam lists Asia/Bangkok) is settled by the
 * countries the trip names; a single-country trip settles everything else.
 */
export function dayCountry(day: HolidayDay, tripCountries: readonly string[]): string | null {
  const zoned = day.timeZone ? countriesInZone(day.timeZone) : [];
  const named = zoned.filter((code) => tripCountries.includes(code));
  if (named.length === 1) return named[0]!;
  if (zoned.length === 1) return zoned[0]!;
  return tripCountries.length === 1 ? tripCountries[0]! : null;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

let supportedCountries: Set<string> | undefined;

function publicHolidays(country: string, year: number, language: string) {
  supportedCountries ??= new Set(Object.keys(new Holidays().getCountries()));
  if (!supportedCountries.has(country)) return [];
  // The dataset names holidays by ISO 639-1 code, so `en-GB` asks for `en`.
  const languages = [language.slice(0, 2).toLowerCase(), 'en'];
  const holidays: HolidaysTypes.Holiday[] = new Holidays(country, { languages }).getHolidays(year);
  return holidays
    .filter((holiday) => holiday.type === 'public')
    .map((holiday) => {
      // `date` is the local start, sometimes with an offset suffix; a
      // multi-day holiday (Tết) spans every local date up to `end`.
      const start = holiday.date.slice(0, 10);
      const length = Math.max(
        1,
        Math.round((holiday.end.getTime() - holiday.start.getTime()) / 86_400_000),
      );
      return {
        dates: Array.from({ length }, (_, index) => addDays(start, index)),
        name: holiday.name,
        certainty: HIJRI_MONTH.test(holiday.rule) ? ('expected' as const) : ('official' as const),
      };
    });
}

/** The public holidays that fall on the trip's days, one entry per holiday date. */
export function tripHolidays(input: {
  days: readonly HolidayDay[];
  countries: readonly string[];
  language: string;
}): TripContextHoliday[] {
  const calendars = new Map<string, ReturnType<typeof publicHolidays>>();
  const found = new Map<string, TripContextHoliday>();
  for (const day of input.days) {
    const country = dayCountry(day, input.countries);
    if (!country) continue;
    const year = Number(day.date.slice(0, 4));
    const key = `${country}:${year}`;
    if (!calendars.has(key)) calendars.set(key, publicHolidays(country, year, input.language));
    for (const holiday of calendars.get(key)!) {
      if (!holiday.dates.includes(day.date)) continue;
      const id = `${country}:${day.date}:${holiday.name}`;
      const entry = found.get(id) ?? {
        date: day.date,
        dayIds: [],
        countryCode: country,
        name: holiday.name,
        certainty: holiday.certainty,
      };
      entry.dayIds.push(day.id);
      found.set(id, entry);
    }
  }
  return [...found.values()].toSorted(
    (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
  );
}
