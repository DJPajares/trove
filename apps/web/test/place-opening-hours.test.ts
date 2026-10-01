import { expect, test } from 'vitest';

import { placeWeekdayIndex } from '../lib/places/opening-hours.ts';

// Thursday 1 October 2026, 22:30 UTC.
const now = new Date('2026-10-01T22:30:00Z');

test.each([
  { expected: 3, offset: 0, where: 'a place on UTC is still Thursday' },
  { expected: 4, offset: 9 * 60, where: 'Tokyo has already reached Friday' },
  { expected: 3, offset: -7 * 60, where: 'Los Angeles is still Thursday' },
  { expected: 4, offset: 90, where: 'an offset that crosses midnight is Friday' },
])('$where', ({ expected, offset }) => {
  expect(placeWeekdayIndex(offset, now)).toBe(expected);
});

test('Sunday is the last of Google’s Monday-first lines', () => {
  expect(placeWeekdayIndex(0, new Date('2026-10-04T12:00:00Z'))).toBe(6);
  expect(placeWeekdayIndex(0, new Date('2026-10-05T12:00:00Z'))).toBe(0);
});

test('a place with no known offset has no today', () => {
  expect(placeWeekdayIndex(null, now)).toBe(null);
  expect(placeWeekdayIndex(undefined, now)).toBe(null);
  expect(placeWeekdayIndex(Number.NaN, now)).toBe(null);
});
