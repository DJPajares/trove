import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  DAY_PART_ORDER,
  DAY_PART_WINDOWS,
  dayPartIndexForHour,
  dayPartWindow,
} from '../src/services/day-part-windows.js';

test('the three dayparts tile the whole day without gaps or overlap', () => {
  const ordered = DAY_PART_ORDER.map((part) => DAY_PART_WINDOWS[part]);

  assert.equal(ordered[0]?.startMinute, 0);
  assert.equal(ordered.at(-1)?.endMinute, 1440);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(ordered[index]?.startMinute, ordered[index - 1]?.endMinute);
  }
});

test('each daypart resolves to its window', () => {
  assert.deepEqual(dayPartWindow('MORNING'), { endMinute: 720, startMinute: 0 });
  assert.deepEqual(dayPartWindow('AFTERNOON'), { endMinute: 1020, startMinute: 720 });
  assert.deepEqual(dayPartWindow('EVENING'), { endMinute: 1440, startMinute: 1020 });
});

test('anytime and no timing both constrain nothing', () => {
  // A whole-day range cannot be violated, so it is not evidence any rubric needs.
  assert.equal(dayPartWindow('ANYTIME'), null);
  assert.equal(dayPartWindow(null), null);
  assert.equal(dayPartWindow(undefined), null);
  assert.equal(dayPartWindow('NONSENSE'), null);
});

test('the hour boundaries Trip Mode uses come from the same windows', () => {
  assert.equal(dayPartIndexForHour(0), 0);
  assert.equal(dayPartIndexForHour(11), 0);
  assert.equal(dayPartIndexForHour(12), 1);
  assert.equal(dayPartIndexForHour(16), 1);
  assert.equal(dayPartIndexForHour(17), 2);
  assert.equal(dayPartIndexForHour(23), 2);
});

test('an hour past the end of the day still lands in the last daypart', () => {
  assert.equal(dayPartIndexForHour(24), 2);
  assert.equal(dayPartIndexForHour(99), 2);
});
