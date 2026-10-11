import { expect, test } from 'vitest';

import { isSavedRateStale } from '@/lib/currency/api';
import { countriesUsingCurrency } from '@/lib/currency/country-currency';
import { priceTagCurrency, priceTagSteps } from '@/lib/currency/price-tags';
import { tripCurrencySuggestions } from '@/lib/tools/shelf';

test('price tags are round local amounts a few units of the other currency apart', () => {
  expect(priceTagSteps(163.2)).toEqual([500, 1000, 2000, 5000, 10000, 20000]);
  expect(priceTagSteps(20198)).toEqual([50000, 100000, 200000, 500000, 1000000, 2000000]);
  expect(priceTagSteps(0.92)).toEqual([0.5, 1, 2, 5, 10, 20]);
  expect(priceTagSteps(0)).toEqual([]);
  expect(priceTagSteps(Number.NaN)).toEqual([]);
});

test('price tags are in whichever currency is not home', () => {
  expect(priceTagCurrency({ source: 'EUR', target: 'JPY' }, 'EUR')).toBe('JPY');
  expect(priceTagCurrency({ source: 'JPY', target: 'EUR' }, 'EUR')).toBe('JPY');
  expect(priceTagCurrency({ source: 'SGD', target: 'VND' }, 'EUR')).toBe('VND');
  expect(priceTagCurrency({ source: 'SGD', target: 'VND' }, null)).toBe('VND');
});

test('a saved rate is only flagged once it outlives the half-day cache', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  expect(isSavedRateStale('2026-10-11T06:00:00Z', now)).toBe(false);
  expect(isSavedRateStale('2026-10-10T20:00:00Z', now)).toBe(true);
});

test('a currency can be found by the countries that spend it', () => {
  expect(countriesUsingCurrency('jpy')).toEqual(['JP']);
  expect(countriesUsingCurrency('EUR')).toContain('PT');
  expect(countriesUsingCurrency('XXX')).toEqual([]);
});

test('trips ahead suggest their currencies, soonest first and each once', () => {
  const trip = (name: string, startDate: string, endDate: string, countries: string[]) => ({
    countries,
    endDate,
    lifecycle: 'planning' as const,
    name,
    startDate,
  });
  const trips = [
    trip('Lisbon', '2026-12-04', '2026-12-07', ['PT']),
    trip('Kyoto', '2026-10-30', '2026-11-03', ['JP']),
    trip('Osaka', '2027-02-01', '2027-02-05', ['JP']),
    trip('Past', '2026-01-01', '2026-01-05', ['GB']),
    trip('Scotland', '2027-01-12', '2027-01-19', ['GB']),
  ];
  expect(
    tripCurrencySuggestions(trips, 'EUR', '2026-10-11').map(
      (entry) => `${entry.currency}:${entry.trip.name}`,
    ),
  ).toEqual(['JPY:Kyoto', 'GBP:Scotland']);
});
