import { expect, test } from 'vitest';

import { isKnownCountry, namedCountries, namedCountryLine } from '../lib/trips/countries.ts';

test('countries are named in the reader s language, in the order they were picked', () => {
  expect(namedCountries(['JP', 'KR'], 'en')).toStrictEqual([
    { code: 'JP', flag: '🇯🇵', name: 'Japan' },
    { code: 'KR', flag: '🇰🇷', name: 'South Korea' },
  ]);

  // The reader's own language, which is the whole reason this is not the
  // English name the editorial photo asks for.
  expect(namedCountries(['JP'], 'fr').map((country) => country.name)).toStrictEqual(['Japon']);
});

test('a code Trove does not know is dropped rather than shown', () => {
  // CLDR answers an unrecognised region with "Unknown Region", so the guard has
  // to run before Intl does - otherwise a typo reads as a place.
  expect(namedCountries(['ZZ'], 'en')).toStrictEqual([]);
  expect(namedCountries(['ZZ', 'JP'], 'en').map((country) => country.code)).toStrictEqual(['JP']);
  expect(isKnownCountry('ZZ')).toBe(false);
  expect(isKnownCountry(undefined)).toBe(false);
  expect(isKnownCountry('JP')).toBe(true);
});

test('a trip that named no country asks for no line at all', () => {
  // Every trip created before the field existed is such a trip, and a
  // placeholder there would be the "Destination still open" mistake again.
  expect(namedCountries([], 'en')).toStrictEqual([]);
  expect(namedCountries(undefined, 'en')).toStrictEqual([]);
  expect(namedCountryLine([], 'en')).toBeNull();
  expect(namedCountryLine(['ZZ'], 'en')).toBeNull();
});

test('the one-line form joins flag and name', () => {
  expect(namedCountryLine(['JP', 'KR'], 'en')).toBe('🇯🇵 Japan · 🇰🇷 South Korea');
});
