import { expect, test } from 'vitest';

import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import {
  countTripPlaces,
  FAR_FROM_DAY_METRES,
  filterTripPlaces,
  foldPlaceText,
  formatDayNumbers,
  isFarFromDay,
  itineraryReferences,
  matchesPlaceQuery,
} from '@/lib/trip-places/list-view';

function use(dayNumbers: number[], unscheduledCount = 0): ScheduledPlaceUse {
  return {
    dayDates: dayNumbers.map((day) => `2026-10-${String(8 + day).padStart(2, '0')}`),
    dayNumbers,
    itemCount: dayNumbers.length + unscheduledCount,
    unscheduledCount,
  };
}

const places = [
  { id: 'old-quarter', name: 'Hanoi Old Quarter', address: 'Hoàn Kiếm, Hà Nội' },
  { id: 'station', name: 'Hanoi Railway Station', address: 'Đống Đa, Hà Nội' },
  { id: 'market', name: 'Sapa Market', address: 'Sa Pa, Lào Cai' },
  { id: 'bay', name: 'Ha Long Bay', address: null },
];
const fieldsOf = (place: (typeof places)[number]) => [place.name, place.address];
const ids = (list: readonly { id: string }[]) => list.map((place) => place.id);

test('folding drops case, accents, the Vietnamese đ, spacing and punctuation', () => {
  expect(foldPlaceText('Đống Đa, Hà Nội')).toBe('dongdahanoi');
  expect(foldPlaceText('  Café  ')).toBe('cafe');
});

test('every word of a search has to appear, accents or not', () => {
  const show = 'all' as const;
  const search = (query: string) => ids(filterTripPlaces(places, { fieldsOf, query, show }));

  expect(search('ha noi')).toStrictEqual(['old-quarter', 'station']);
  expect(search('hanoi')).toStrictEqual(['old-quarter', 'station']);
  expect(search('dong da')).toStrictEqual(['station']);
  expect(search('market sapa')).toStrictEqual(['market']);
  expect(search('   ')).toStrictEqual(ids(places));
  expect(search('zzz')).toStrictEqual([]);
  // A word cannot be matched across the end of one field and the start of the next.
  expect(matchesPlaceQuery(['Sapa', 'Market'], 'apama')).toBe(false);
});

test('"not on a day" keeps Unscheduled-only places, and places just added stay', () => {
  const placeUse = {
    'old-quarter': use([1]),
    bay: use([2, 3]),
    market: use([], 1),
  };
  const unplanned = (keep?: ReadonlySet<string>) =>
    ids(filterTripPlaces(places, { fieldsOf, keep, placeUse, query: '', show: 'unplanned' }));

  expect(unplanned()).toStrictEqual(['station', 'market']);
  expect(unplanned(new Set(['bay']))).toStrictEqual(['station', 'market', 'bay']);
  expect(countTripPlaces(places, placeUse)).toStrictEqual({ all: 4, unplanned: 2 });
  expect(countTripPlaces(places)).toStrictEqual({ all: 4, unplanned: 4 });
});

test('days read in order, with consecutive days joined into a range', () => {
  expect(formatDayNumbers([4], 'en')).toBe('4');
  expect(formatDayNumbers([3, 2], 'en')).toBe('2–3');
  expect(formatDayNumbers([5, 1, 2, 3, 3], 'en')).toBe('1–3, 5');
  expect(formatDayNumbers([1, 4, 6], 'en')).toBe('1, 4, 6');
});

test('a place is far from a day only beyond a destination’s reach of every stop', () => {
  expect(FAR_FROM_DAY_METRES).toBe(50_000);
  expect(isFarFromDay(1_800)).toBe(false);
  expect(isFarFromDay(50_000)).toBe(false);
  expect(isFarFromDay(139_000)).toBe(true);
});

test('removal is blocked by whichever count of itinerary stops is larger', () => {
  const place = { id: 'bay', referenceCount: 0 };
  expect(itineraryReferences(place)).toBe(0);
  expect(itineraryReferences(place, { bay: use([2, 3]) })).toBe(2);
  expect(itineraryReferences({ ...place, referenceCount: 3 }, { bay: use([2]) })).toBe(3);
});
