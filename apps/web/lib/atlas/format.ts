import type { TemperatureUnit } from '@/lib/profile/preferences';

/** A typical temperature, rounded, in the traveller's unit. Patterns never need decimals. */
export function formatAtlasTemperature(celsius: number, unit: TemperatureUnit) {
  const value = unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius;
  return `${Math.round(value)}°`;
}

/** Wet-day share as "about N in 10 days", never claiming more precision than a pattern has. */
export function wetDaysInTen(wetDayShare: number) {
  return Math.max(0, Math.min(10, Math.round(wetDayShare * 10)));
}

export function monthName(
  month: number,
  locale: string,
  width: 'long' | 'short' | 'narrow' = 'long',
) {
  return new Intl.DateTimeFormat(locale, { month: width, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2001, month - 1, 1)),
  );
}

/** "Apr–May, Oct–Nov": runs of months, short names, in the reader's locale. */
export function formatMonthRuns(runs: readonly number[][], locale: string) {
  return new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(
    runs.map((run) =>
      run.length === 1
        ? monthName(run[0]!, locale, 'short')
        : `${monthName(run[0]!, locale, 'short')}–${monthName(run[run.length - 1]!, locale, 'short')}`,
    ),
  );
}

/** Rough reading time for plain guide text, at about 220 words a minute. */
export function readingMinutes(words: number) {
  return Math.max(1, Math.round(words / 220));
}
