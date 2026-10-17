import { expect, test } from 'vitest';

import { isAccommodation, placeCategories, stayOptions } from '../lib/trip-places/categories.ts';

const place = (id: string, categories?: string[], snapshotCategory?: string) => ({
  categories: categories as never,
  id,
  place: { snapshot: snapshotCategory ? { category: snapshotCategory as never } : null },
});

test('a place cached before categories still says what its snapshot did', () => {
  expect(placeCategories(place('a', undefined, 'stay'))).toEqual(['stay']);
  expect(placeCategories(place('b'))).toEqual(['other']);
  expect(isAccommodation(place('c', ['food_and_drink', 'stay']))).toBe(true);
});

test('Stay offers somewhere to stay, and never drops what is already chosen', () => {
  const places = [
    place('hotel', ['stay']),
    place('cafe', ['food_and_drink']),
    place('museum', ['things_to_do']),
  ];
  expect(stayOptions(places, []).map((entry) => entry.id)).toEqual(['hotel']);
  expect(stayOptions(places, ['museum', null]).map((entry) => entry.id)).toEqual([
    'hotel',
    'museum',
  ]);
});
