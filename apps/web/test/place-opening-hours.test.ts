import { expect, test, vi } from 'vitest';

import { placeWeekdayIndex, visitWeekdayIndex } from '../lib/places/opening-hours.ts';

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

test.each([
  ['2026-10-05', 0],
  ['2026-10-06', 1],
  ['2026-10-07', 2],
  ['2026-10-08', 3],
  ['2026-10-09', 4],
  ['2026-10-10', 5],
  ['2026-10-11', 6],
] as const)('visit on %s selects its Monday-first weekday', (date, expected) => {
  expect(visitWeekdayIndex(date, undefined, now)).toBe(expected);
});

test.each(['Pacific/Honolulu', 'Asia/Tokyo', 'Pacific/Kiritimati'])(
  'a visit stays on its calendar day when the device is in %s',
  (timeZone) => {
    vi.stubEnv('TZ', timeZone);
    try {
      expect(visitWeekdayIndex('2026-10-04', -10 * 60, now)).toBe(6);
      expect(visitWeekdayIndex('2026-10-04', 14 * 60, now)).toBe(6);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);

test('an omitted visit uses today at the place, but an ambiguous visit stays neutral', () => {
  expect(visitWeekdayIndex(undefined, 9 * 60, now)).toBe(4);
  expect(visitWeekdayIndex(undefined, undefined, now)).toBeNull();
  expect(visitWeekdayIndex(null, 9 * 60, now)).toBeNull();
});

test.each(['2026-02-30', 'not-a-date', '2026-10-04T00:00:00Z', ''])(
  'invalid visit %s remains neutral instead of substituting today',
  (date) => {
    expect(visitWeekdayIndex(date, 9 * 60, now)).toBeNull();
  },
);
