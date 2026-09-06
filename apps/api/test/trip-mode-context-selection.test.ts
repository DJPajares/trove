import { expect, test } from 'vitest';

import { resolveTripModeItemSelection } from '../src/services/trip-mode-context.js';

type ScheduledItem = {
  dayPart: 'AFTERNOON' | 'ANYTIME' | 'EVENING' | 'MORNING' | null;
  durationMinutes: number | null;
  id: string;
  localStartTime: Date | null;
  startInstant: Date | null;
  timeSemantics: 'AUTHORITATIVE_INSTANT' | 'FLOATING_LOCAL' | null;
  timeZone: string | null;
};

/**
 * A stop known only by its instant. With no entered local time there is nothing
 * to re-ground, so these exercise the instant path exactly as they always did.
 */
function item(id: string, start: string | null, overrides: Partial<ScheduledItem> = {}) {
  return {
    dayPart: null,
    durationMinutes: null,
    id,
    localStartTime: null,
    startInstant: start ? new Date(start) : null,
    timeSemantics: null,
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

/** A stop the traveller entered as a wall-clock time, the way most are. */
function floatingItem(id: string, localTime: string, overrides: Partial<ScheduledItem> = {}) {
  const [hour = 0, minute = 0] = localTime.split(':').map(Number);

  return {
    dayPart: null,
    durationMinutes: null,
    id,
    localStartTime: new Date(Date.UTC(1970, 0, 1, hour, minute)),
    // Ground in Singapore, the way a trip created there stores it: 09:00 local
    // becomes 01:00Z, which is one in the afternoon in New Zealand.
    startInstant: new Date(`2026-09-06T${String(hour - 8).padStart(2, '0')}:00:00.000Z`),
    timeSemantics: 'FLOATING_LOCAL' as const,
    timeZone: 'Asia/Singapore',
    ...overrides,
  } satisfies ScheduledItem;
}

test('a stop written as 9am is current at 9am where the traveller is', () => {
  const items = [floatingItem('hobbiton', '09:00'), floatingItem('lunch', '12:00')];
  // 21:00Z on the 5th is 9am on the 6th in New Zealand.
  const at = new Date('2026-09-05T21:00:00.000Z');

  const onTheTravellersClock = resolveTripModeItemSelection(
    items,
    '2026-09-06',
    'Pacific/Auckland',
    at,
  );

  expect(onTheTravellersClock.currentOrRelevant).toMatchObject({
    item: { id: 'hobbiton' },
    kind: 'current',
  });
  expect(onTheTravellersClock.nextItem).toMatchObject({ id: 'lunch' });
});

test('the same moment read on the trip’s own clock is still hours early', () => {
  const items = [floatingItem('hobbiton', '09:00'), floatingItem('lunch', '12:00')];
  const at = new Date('2026-09-05T21:00:00.000Z');

  // The zone the trip was created in says it is only 5am, so nothing has begun.
  // This is what the traveller was seeing while standing at the stop.
  const onTheTripsClock = resolveTripModeItemSelection(items, '2026-09-06', 'Asia/Singapore', at);

  expect(onTheTripsClock.currentOrRelevant).toBeNull();
  expect(onTheTripsClock.nextItem).toMatchObject({ id: 'hobbiton' });
});

test('a flight keeps the instant it was given, whatever the phone says', () => {
  const departure = floatingItem('flight', '09:00', {
    startInstant: new Date('2026-09-06T01:00:00.000Z'),
    timeSemantics: 'AUTHORITATIVE_INSTANT',
  });

  // 9am in New Zealand is 21:00Z the day before - well before the 01:00Z
  // departure, which an authoritative instant must not be re-grounded away from.
  const result = resolveTripModeItemSelection(
    [departure],
    '2026-09-06',
    'Pacific/Auckland',
    new Date('2026-09-05T21:00:00.000Z'),
  );

  expect(result.currentOrRelevant).toBeNull();
  expect(result.nextItem).toMatchObject({ id: 'flight' });
});
