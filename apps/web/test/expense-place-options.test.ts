import { expect, test } from 'vitest';

import type { ExpensePlace } from '@/lib/expenses/api';
import { expensePlaceOptions } from '@/lib/expenses/place-options';

const place = (id: string, name: string): ExpensePlace => ({
  id,
  kind: 'custom',
  name,
  placeId: `place-${id}`,
  providerRefs: [],
});

const tripPlaces = [
  place('c', 'Cafe Dinh'),
  place('a', 'Temple of Literature'),
  place('b', 'Bánh mì 25'),
];
const days = [
  { date: '2026-11-13', id: 'day-1' },
  { date: '2026-11-14', id: 'day-2' },
];
const itineraryItems = [
  { id: 'i1', itineraryDayId: 'day-1', label: null, place: tripPlaces[1]! },
  { id: 'i2', itineraryDayId: 'day-1', label: null, place: tripPlaces[0]! },
  { id: 'i3', itineraryDayId: 'day-2', label: 'Rest', place: null },
];
const options = (localDate: string, selectedId = 'none') =>
  expensePlaceOptions({
    days,
    fallbackLabel: 'Unnamed place',
    itineraryItems,
    locale: 'en',
    localDate,
    selectedId,
    tripPlaces,
  }).map((option) => option.name);

test("a dated expense offers that day's stops, A to Z", () => {
  expect(options('2026-11-13')).toStrictEqual(['Cafe Dinh', 'Temple of Literature']);
});

test('an undated expense offers every trip place, A to Z, ignoring accents', () => {
  expect(options('')).toStrictEqual(['Bánh mì 25', 'Cafe Dinh', 'Temple of Literature']);
});

test('a day with no place stops falls back to every trip place', () => {
  expect(options('2026-11-14')).toHaveLength(3);
});

test('the place already linked stays listed even when it is not a stop that day', () => {
  expect(options('2026-11-13', 'b')).toStrictEqual([
    'Bánh mì 25',
    'Cafe Dinh',
    'Temple of Literature',
  ]);
});
