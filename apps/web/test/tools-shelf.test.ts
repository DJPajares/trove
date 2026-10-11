import { expect, test } from 'vitest';

import { currencyForCountry } from '@/lib/currency/country-currency';
import { currencyPairHref } from '@/lib/currency/recent-pairs';
import { nextTripForTools, tripLocalCurrency } from '@/lib/tools/shelf';

const trip = (
  startDate: string,
  endDate: string,
  countries: string[],
  lifecycle: 'active' | 'completed' | 'planning' = 'planning',
) => ({ countries, endDate, lifecycle, startDate });

test('a country gives the currency a visitor spends there', () => {
  expect(currencyForCountry('JP')).toBe('JPY');
  expect(currencyForCountry('pt')).toBe('EUR');
  expect(currencyForCountry('ZZ')).toBeNull();
  expect(currencyForCountry(null)).toBeNull();
});

test('the shelf works for the trip underway, else the soonest ahead', () => {
  const trips = [
    trip('2026-12-05', '2026-12-08', ['PT']),
    trip('2026-10-09', '2026-10-13', ['VN'], 'active'),
    trip('2026-09-01', '2026-09-05', ['JP'], 'completed'),
  ];
  expect(nextTripForTools(trips, '2026-10-11')?.countries).toEqual(['VN']);
  expect(nextTripForTools(trips, '2026-10-14')?.countries).toEqual(['PT']);
  expect(nextTripForTools(trips, '2026-12-09')).toBeNull();
});

test('a trip offers the first currency that differs from home', () => {
  expect(tripLocalCurrency(trip('2026-10-30', '2026-11-03', ['JP']), 'EUR')).toBe('JPY');
  expect(tripLocalCurrency(trip('2026-10-30', '2026-11-03', ['FR', 'CH']), 'EUR')).toBe('CHF');
  expect(tripLocalCurrency(trip('2026-10-30', '2026-11-03', ['FR']), 'EUR')).toBeNull();
  expect(tripLocalCurrency(trip('2026-10-30', '2026-11-03', []), 'EUR')).toBeNull();
});

test('a pair opens the converter on that pair', () => {
  expect(currencyPairHref({ source: 'EUR', target: 'JPY' })).toBe(
    '/tools/currency?from=EUR&to=JPY',
  );
});
