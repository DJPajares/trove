import { expect, test } from 'vitest';

import { COUNTRY_CODES, COUNTRY_TIME_ZONES, timeZoneForCountry } from '@trove/types/countries';

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
