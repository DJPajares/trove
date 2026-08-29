import { expect, test } from 'vitest';

import {
  allOverviewDaysExpanded,
  initiallyExpandedOverviewDayIds,
  setAllOverviewDaysExpanded,
  toggleOverviewDay,
} from '../lib/itinerary/overview-disclosure.ts';

const DAYS = [
  { id: 'day-1', items: [{}] },
  { id: 'day-2', items: [{}] },
  { id: 'day-3', items: [] },
];

const POPULATED_DAY_IDS = ['day-1', 'day-2'];

test('starts with every populated day expanded', () => {
  expect(initiallyExpandedOverviewDayIds(DAYS)).toEqual(new Set(POPULATED_DAY_IDS));
});

test('toggles an individual day without changing the others', () => {
  const collapsed = toggleOverviewDay(new Set(POPULATED_DAY_IDS), 'day-1', false);

  expect(collapsed).toEqual(new Set(['day-2']));
  expect(allOverviewDaysExpanded(collapsed, POPULATED_DAY_IDS)).toBe(false);
  expect(toggleOverviewDay(collapsed, 'day-1', true)).toEqual(new Set(POPULATED_DAY_IDS));
});

test('collapses and expands every populated day while leaving empty days out of state', () => {
  const collapsed = setAllOverviewDaysExpanded(
    new Set(POPULATED_DAY_IDS),
    POPULATED_DAY_IDS,
    false,
  );

  expect(collapsed).toEqual(new Set());
  expect(setAllOverviewDaysExpanded(collapsed, POPULATED_DAY_IDS, true)).toEqual(
    new Set(POPULATED_DAY_IDS),
  );
});
