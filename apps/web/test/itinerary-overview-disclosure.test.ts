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

const DAY_IDS = ['day-1', 'day-2', 'day-3'];

test('starts with every day expanded, including empty days', () => {
  expect(initiallyExpandedOverviewDayIds(DAYS)).toEqual(new Set(DAY_IDS));
});

test('toggles an individual day without changing the others', () => {
  const collapsed = toggleOverviewDay(new Set(DAY_IDS), 'day-1', false);

  expect(collapsed).toEqual(new Set(['day-2', 'day-3']));
  expect(allOverviewDaysExpanded(collapsed, DAY_IDS)).toBe(false);
  expect(toggleOverviewDay(collapsed, 'day-1', true)).toEqual(new Set(DAY_IDS));
});

test('collapses and expands every day, including empty days', () => {
  const collapsed = setAllOverviewDaysExpanded(new Set(DAY_IDS), DAY_IDS, false);

  expect(collapsed).toEqual(new Set());
  expect(setAllOverviewDaysExpanded(collapsed, DAY_IDS, true)).toEqual(new Set(DAY_IDS));
});
