import { expect, test } from 'vitest';

import { resolveTripModeItemSelection } from '../src/services/trip-mode-context.js';

type ScheduledItem = {
  dayPart: 'AFTERNOON' | 'ANYTIME' | 'EVENING' | 'MORNING' | null;
  durationMinutes: number | null;
  id: string;
  startInstant: Date | null;
  timeZone: string | null;
};

function item(id: string, start: string | null, overrides: Partial<ScheduledItem> = {}) {
  return {
    dayPart: null,
    durationMinutes: null,
    id,
    startInstant: start ? new Date(start) : null,
    timeZone: 'Asia/Singapore',
    ...overrides,
  } satisfies ScheduledItem;
}

function select(items: ScheduledItem[], at: string) {
  return resolveTripModeItemSelection(items, '2026-09-05', 'Asia/Singapore', new Date(at));
}

test('a durationless scheduled item stays current until the next scheduled item begins', () => {
  const result = select(
    [item('breakfast', '2026-09-05T00:00:00.000Z'), item('lunch', '2026-09-05T04:00:00.000Z')],
    '2026-09-05T02:00:00.000Z',
  );

  expect(result.currentOrRelevant).toMatchObject({
    item: { id: 'breakfast' },
    kind: 'current',
    reason: 'exact_time',
  });
  expect(result.nextItem?.id).toBe('lunch');
});

test('the final durationless scheduled item expires after 60 minutes', () => {
  const items = [item('last', '2026-09-05T02:00:00.000Z')];

  expect(select(items, '2026-09-05T02:59:59.000Z').currentOrRelevant?.item.id).toBe('last');
  expect(select(items, '2026-09-05T03:00:00.000Z')).toEqual({
    currentOrRelevant: null,
    nextItem: null,
  });
});

test('an explicit duration ends the current item before a later scheduled start', () => {
  const result = select(
    [
      item('short', '2026-09-05T01:00:00.000Z', { durationMinutes: 30 }),
      item('later', '2026-09-05T03:00:00.000Z'),
    ],
    '2026-09-05T02:00:00.000Z',
  );

  expect(result.currentOrRelevant).toBeNull();
  expect(result.nextItem?.id).toBe('later');
});

test('overlapping scheduled items prefer the most recently started active item', () => {
  const result = select(
    [
      item('long', '2026-09-05T01:00:00.000Z', { durationMinutes: 180 }),
      item('newer', '2026-09-05T02:00:00.000Z', { durationMinutes: 60 }),
      item('next', '2026-09-05T03:30:00.000Z'),
    ],
    '2026-09-05T02:30:00.000Z',
  );

  expect(result.currentOrRelevant?.item.id).toBe('newer');
  expect(result.nextItem?.id).toBe('next');
});

test('next is the earliest future scheduled instant even if itinerary positions differ', () => {
  const result = select(
    [item('late', '2026-09-05T05:00:00.000Z'), item('early', '2026-09-05T03:00:00.000Z')],
    '2026-09-05T02:00:00.000Z',
  );

  expect(result.currentOrRelevant).toBeNull();
  expect(result.nextItem?.id).toBe('early');
});

test('dayparts stay relevant and a later scheduled item remains next', () => {
  const result = select(
    [item('morning', null, { dayPart: 'MORNING' }), item('lunch', '2026-09-05T04:00:00.000Z')],
    '2026-09-05T02:00:00.000Z',
  );

  expect(result.currentOrRelevant).toMatchObject({
    item: { id: 'morning' },
    kind: 'relevant',
    reason: 'day_part',
  });
  expect(result.nextItem?.id).toBe('lunch');
});

test('expired scheduled items do not displace a flexible itinerary item', () => {
  const result = select(
    [item('expired', '2026-09-05T00:00:00.000Z', { durationMinutes: 30 }), item('flexible', null)],
    '2026-09-05T02:00:00.000Z',
  );

  expect(result.currentOrRelevant).toMatchObject({
    item: { id: 'flexible' },
    kind: 'relevant',
    reason: 'itinerary_order',
  });
});
