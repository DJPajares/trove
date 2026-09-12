import { expect, test } from 'vitest';

import {
  COUNTRY_CODES,
  COUNTRY_TIME_ZONES,
  countryFlagEmoji,
  timeZoneForCountry,
} from '@trove/types/countries';

test('every country resolves to a time zone the runtime accepts', () => {
  // Several entries are IANA backward links rather than canonical names, which
  // is exactly the kind of thing that fails silently at render time instead of
  // here.
  const rejected = COUNTRY_CODES.filter((code) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: COUNTRY_TIME_ZONES[code] }).format(new Date());
      return false;
    } catch {
      return true;
    }
  });

  expect(rejected).toEqual([]);
});

test("every country can be named in the reader's own language", () => {
  // The dropdown drops any code Intl cannot name, so a code that fails here is
  // a country nobody could ever pick.
  const displayNames = new Intl.DisplayNames('en', { type: 'region' });
  const unnamed = COUNTRY_CODES.filter((code) => {
    const name = displayNames.of(code);
    return !name || name === code;
  });

  expect(unnamed).toEqual([]);
});

test('a multi-zone country answers with the zone most of it lives in', () => {
  expect(timeZoneForCountry('US')).toBe('America/New_York');
  expect(timeZoneForCountry('AU')).toBe('Australia/Sydney');
  expect(timeZoneForCountry('BR')).toBe('America/Sao_Paulo');
  expect(timeZoneForCountry('CA')).toBe('America/Toronto');
  expect(timeZoneForCountry('RU')).toBe('Europe/Moscow');
});

test('a country code is read whatever its casing', () => {
  expect(timeZoneForCountry('nz')).toBe('Pacific/Auckland');
  expect(timeZoneForCountry('  Ph ')).toBe('Asia/Manila');
});

test('a code Trove does not know resolves to nothing rather than a guess', () => {
  expect(timeZoneForCountry('ZZ')).toBeNull();
  expect(timeZoneForCountry('')).toBeNull();
});

test('a country flag is its own two letters in the regional indicator alphabet', () => {
  expect(countryFlagEmoji('NZ')).toBe('\u{1F1F3}\u{1F1FF}');
  expect(countryFlagEmoji('JP')).toBe('\u{1F1EF}\u{1F1F5}');
});

test('a flag is read whatever its casing', () => {
  expect(countryFlagEmoji('nz')).toBe(countryFlagEmoji('NZ'));
  expect(countryFlagEmoji('  vn ')).toBe(countryFlagEmoji('VN'));
});

/**
 * A caller renders this straight into a span, so an unknown code has to come
 * back as nothing rather than as a pair of stray regional indicators - which
 * would render as some entirely unrelated country's flag.
 */
test('a code Trove does not know has no flag', () => {
  expect(countryFlagEmoji('ZZ')).toBe('');
  expect(countryFlagEmoji('')).toBe('');
  expect(countryFlagEmoji('NZL')).toBe('');
});

test('every country Trove offers has a flag', () => {
  const flagless = COUNTRY_CODES.filter((code) => countryFlagEmoji(code) === '');

  expect(flagless).toEqual([]);
});
