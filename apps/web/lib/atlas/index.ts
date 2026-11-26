import {
  ATLAS_REGIONS,
  type AtlasIndexEntry,
  type AtlasMonthClimate,
  type AtlasRegion,
} from '@trove/types';
import { ATLAS_INDEX } from '@trove/types/atlas-index';

export type AtlasCountry = AtlasIndexEntry & { name: string };

export { ATLAS_REGIONS, type AtlasRegion };

/** Every country in the bundled index, named and sorted in the reader's locale. */
export function atlasCountries(locale: string): AtlasCountry[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return ATLAS_INDEX.countries
    .map((country) => ({ ...country, name: names.of(country.countryCode) ?? country.countryCode }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function atlasCountry(countryCode: string, locale: string): AtlasCountry | null {
  const entry = ATLAS_INDEX.countries.find((country) => country.countryCode === countryCode);
  if (!entry) return null;
  const names = new Intl.DisplayNames([locale], { type: 'region' });
  return { ...entry, name: names.of(entry.countryCode) ?? entry.countryCode };
}

/** Accent- and case-insensitive match on the country's name in the reader's locale. */
export function matchesAtlasQuery(country: AtlasCountry, query: string) {
  const fold = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase();
  const needle = fold(query.trim());
  return (
    !needle ||
    fold(country.name).includes(needle) ||
    country.countryCode === query.trim().toUpperCase()
  );
}

export function monthClimate(country: AtlasIndexEntry, month: number): AtlasMonthClimate | null {
  return country.months?.find((entry) => entry.month === month) ?? null;
}

/** The calendar month after the one `today` falls in, 1 to 12. */
export function nextMonth(today: Date) {
  return ((today.getMonth() + 1) % 12) + 1;
}

/**
 * A small, stable hash so a month's featured countries rotate each year
 * without a server and without reshuffling on every visit.
 */
function seededOrder(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Among the world's most visited countries (UN Tourism arrival rankings), so a
 * month's featured row opens with places most travellers recognise. It only
 * orders the row; every country in the index is still browsable.
 */
const WIDELY_VISITED = new Set(
  'FR ES US IT TR MX GB DE GR AT JP TH CN MY PT NL AE SA HK PL CA HR VN IN EG MA ID ZA AU NZ PE AR BR CL CO CR KE TZ IS NO CH CZ HU IE JO LK NP PH KR SG OM'.split(
    ' ',
  ),
);

/**
 * Countries whose typical conditions rate a month great, then good, in a
 * stable order for that month and year. The rating is a pattern from past
 * years, never a forecast.
 */
export function bestForMonth(
  countries: readonly AtlasCountry[],
  month: number,
  year: number,
): { great: AtlasCountry[]; good: AtlasCountry[] } {
  const rated = (rating: AtlasMonthClimate['rating']) =>
    countries
      .filter((country) => monthClimate(country, month)?.rating === rating)
      .sort(
        (a, b) =>
          Number(WIDELY_VISITED.has(b.countryCode)) - Number(WIDELY_VISITED.has(a.countryCode)) ||
          seededOrder(`${year}-${month}-${a.countryCode}`) -
            seededOrder(`${year}-${month}-${b.countryCode}`),
      );
  return { good: rated('good'), great: rated('great') };
}

/** Consecutive runs of great months, as 1-based month numbers, wrapping December to January. */
export function greatMonthRuns(country: AtlasIndexEntry): number[][] {
  const great = new Set(
    (country.months ?? []).filter((m) => m.rating === 'great').map((m) => m.month),
  );
  if (!great.size) return [];
  if (great.size === 12) return [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];
  // Start just after a month that is not great, so a run across the new year stays whole.
  let start = 1;
  while (great.has(start)) start += 1;
  const runs: number[][] = [];
  let current: number[] = [];
  for (let offset = 1; offset <= 12; offset += 1) {
    const month = ((start + offset - 1) % 12) + 1;
    if (great.has(month)) current.push(month);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}
