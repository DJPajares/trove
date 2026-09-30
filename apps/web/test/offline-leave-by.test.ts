import { expect, test } from 'vitest';

import { offlineLeaveBy, OFFLINE_LEAVE_BY_BUFFER_SECONDS } from '@/lib/itinerary/offline-leave-by';

const at = Date.parse('2026-10-03T09:00:00.000Z');
const start = Date.parse('2026-10-03T10:00:00.000Z');
const current = { id: 'museum', tripPlace: {} };
const next = { id: 'lunch', tripPlace: {} };
const leg = {
  destinationItemId: 'lunch',
  distanceMeters: 1200,
  durationSeconds: 900,
  fetchedAt: '2026-09-29T00:00:00.000Z',
  mode: 'walk',
  originItemId: 'museum',
};

test('leave-by comes from the measured leg, less the usual buffer, dated', () => {
  const result = offlineLeaveBy({
    at,
    currentItem: current,
    legs: [leg],
    nextItem: next,
    targetStart: start,
  });
  expect(result).toMatchObject({
    at: new Date(start - (900 + OFFLINE_LEAVE_BY_BUFFER_SECONDS) * 1000).toISOString(),
    measuredAt: '2026-09-29T00:00:00.000Z',
    routeDurationSeconds: 900,
  });
});

test('no measured leg, no place, no start ahead: no leave-by, never a guess', () => {
  const base = { at, currentItem: current, legs: [leg], nextItem: next, targetStart: start };
  expect(offlineLeaveBy({ ...base, legs: [] })).toBeNull();
  expect(offlineLeaveBy({ ...base, nextItem: { id: 'lunch', tripPlace: null } })).toBeNull();
  expect(offlineLeaveBy({ ...base, targetStart: null })).toBeNull();
  expect(offlineLeaveBy({ ...base, targetStart: at - 1 })).toBeNull();
});
