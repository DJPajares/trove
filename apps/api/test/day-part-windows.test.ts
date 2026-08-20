import { expect, test } from 'vitest';

import {
  DAY_PART_ORDER,
  DAY_PART_WINDOWS,
  dayPartIndexForHour,
  dayPartWindow,
} from '../src/services/day-part-windows.js';

test('the three dayparts tile the whole day without gaps or overlap', () => {
  const ordered = DAY_PART_ORDER.map((part) => DAY_PART_WINDOWS[part]);

  expect(ordered[0]?.startMinute).toBe(0);
  expect(ordered.at(-1)?.endMinute).toBe(1440);
  for (let index = 1; index < ordered.length; index += 1) {
    expect(ordered[index]?.startMinute).toBe(ordered[index - 1]?.endMinute);
  }
});

test('each daypart resolves to its window', () => {
  expect(dayPartWindow('MORNING')).toStrictEqual({ endMinute: 720, startMinute: 0 });
  expect(dayPartWindow('AFTERNOON')).toStrictEqual({ endMinute: 1020, startMinute: 720 });
  expect(dayPartWindow('EVENING')).toStrictEqual({ endMinute: 1440, startMinute: 1020 });
});

test('anytime and no timing both constrain nothing', () => {
  // A whole-day range cannot be violated, so it is not evidence any rubric needs.
  expect(dayPartWindow('ANYTIME')).toBe(null);
  expect(dayPartWindow(null)).toBe(null);
  expect(dayPartWindow(undefined)).toBe(null);
  expect(dayPartWindow('NONSENSE')).toBe(null);
});

test('the hour boundaries Trip Mode uses come from the same windows', () => {
  expect(dayPartIndexForHour(0)).toBe(0);
  expect(dayPartIndexForHour(11)).toBe(0);
  expect(dayPartIndexForHour(12)).toBe(1);
  expect(dayPartIndexForHour(16)).toBe(1);
  expect(dayPartIndexForHour(17)).toBe(2);
  expect(dayPartIndexForHour(23)).toBe(2);
});

test('an hour past the end of the day still lands in the last daypart', () => {
  expect(dayPartIndexForHour(24)).toBe(2);
  expect(dayPartIndexForHour(99)).toBe(2);
});
