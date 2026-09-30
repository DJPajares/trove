import { expect, test } from 'vitest';

import { groupPlacesIntoDays, NEARBY_DAY_KM } from '../src/services/place-groupings.js';

// One degree of longitude at the equator is about 111 km.
const at = (km: number) => ({ latitude: 0, longitude: km / 111.32 });
const day = (id: string, km: number[], overrides: Record<string, number> = {}) => ({
  anchors: km.map(at),
  availableMinutes: 14 * 60,
  id,
  plannedMinutes: 0,
  ...overrides,
});
const place = (id: string, km: number | null, visitMinutes = 60) => ({
  coordinates: km === null ? null : at(km),
  id,
  visitMinutes,
});

test('each place goes to the day whose stops it is nearest', () => {
  const groups = groupPlacesIntoDays(
    [place('near-one', 0.5), place('near-two', 20.4), place('also-one', 1)],
    [day('one', [0]), day('two', [20])],
  );
  expect(groups).toStrictEqual([
    { addedMinutes: 120, dayId: 'one', tripPlaceIds: ['near-one', 'also-one'] },
    { addedMinutes: 60, dayId: 'two', tripPlaceIds: ['near-two'] },
  ]);
});

test('too far from every day, or not located, is not suggested', () => {
  expect(
    groupPlacesIntoDays(
      [place('far', NEARBY_DAY_KM + 1), place('nowhere', null)],
      [day('one', [0])],
    ),
  ).toStrictEqual([]);
});

test('a day with no located stop or base is never guessed at', () => {
  expect(groupPlacesIntoDays([place('p', 0)], [day('empty', [])])).toStrictEqual([]);
});

test('a day is not overfilled: what does not fit is left out, closest kept', () => {
  const groups = groupPlacesIntoDays(
    [place('closest', 0.1, 90), place('middle', 0.5, 90), place('farthest', 1, 90)],
    [day('busy', [0], { availableMinutes: 600, plannedMinutes: 420 })],
  );
  expect(groups).toStrictEqual([
    { addedMinutes: 180, dayId: 'busy', tripPlaceIds: ['closest', 'middle'] },
  ]);
});
