import { expect, test } from 'vitest';

import type { ItineraryDayTimeSuggestion } from '@/lib/itinerary/api';
import {
  defaultSelection,
  describeSuggestedTime,
  formatSuggestedClock,
  orderedUpdates,
  untimedItems,
  type DayTimeRow,
} from '@/lib/itinerary/day-time-suggestions';

const ok = (
  itemId: string,
  localTime: string,
  code = 'OPENING_HOURS',
): ItineraryDayTimeSuggestion =>
  ({
    caveats: [],
    itemId,
    localTime,
    reasons: [{ code, references: [] }],
    status: 'ok',
  }) as unknown as ItineraryDayTimeSuggestion;

const none = (itemId: string): ItineraryDayTimeSuggestion =>
  ({ blockedBy: ['OPENING_HOURS'], itemId, localTime: null, status: 'no_feasible_time' }) as never;

const rows: DayTimeRow[] = [
  { itemId: 'dinner', name: 'Dinner', suggestion: ok('dinner', '19:00') },
  { itemId: 'closed', name: 'Closed museum', suggestion: none('closed') },
  { itemId: 'coffee', name: 'Coffee', suggestion: ok('coffee', '09:30') },
];

const t = (key: string) => key;

test('only untimed stops are candidates', () => {
  const items = [
    { id: 'a', localStartTime: null },
    { id: 'b', localStartTime: '10:00' },
  ] as never;
  expect(untimedItems({ items }).map((item) => item.id)).toStrictEqual(['a']);
});

test('proposals that found a time start selected; the rest cannot be', () => {
  expect([...defaultSelection(rows)].toSorted()).toStrictEqual(['coffee', 'dinner']);
});

test('updates go earliest first and skip what is unselected or has no time', () => {
  expect(orderedUpdates(rows, new Set(['dinner', 'coffee', 'closed']))).toStrictEqual([
    { itemId: 'coffee', localTime: '09:30' },
    { itemId: 'dinner', localTime: '19:00' },
  ]);
  expect(orderedUpdates(rows, new Set(['dinner']))).toStrictEqual([
    { itemId: 'dinner', localTime: '19:00' },
  ]);
  expect(orderedUpdates(rows, new Set())).toStrictEqual([]);
});

test('equal times keep the day order', () => {
  const tied: DayTimeRow[] = [
    { itemId: 'first', name: 'First', suggestion: ok('first', '10:00') },
    { itemId: 'second', name: 'Second', suggestion: ok('second', '10:00') },
  ];
  expect(orderedUpdates(tied, defaultSelection(tied)).map((update) => update.itemId)).toStrictEqual(
    ['first', 'second'],
  );
});

test('the explanation is the reason that moved the clock, then the first caveat', () => {
  expect(describeSuggestedTime(ok('x', '10:00', 'OPENING_HOURS'), t)).toBe(
    'suggestedTime.reason.OPENING_HOURS',
  );
  expect(describeSuggestedTime(none('x'), t)).toBe('connectedTiming.issue.OPENING_HOURS');
  const withCaveat = {
    ...ok('x', '10:00'),
    caveats: ['TRAVEL_ESTIMATED'],
    reasons: [{ code: 'DAY_START', references: [] }],
  } as unknown as ItineraryDayTimeSuggestion;
  expect(describeSuggestedTime(withCaveat, t)).toBe(
    'suggestedTime.applied suggestedTime.caveat.TRAVEL_ESTIMATED',
  );
});

test('times read in the traveller’s own clock format', () => {
  expect(formatSuggestedClock('19:00', 'en', false)).toBe('19:00');
  expect(formatSuggestedClock('19:00', 'en', true)).toMatch(/7:00\s?PM/);
});
