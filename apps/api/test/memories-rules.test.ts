import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  describeCapturedLocalChange,
  deriveCapturedLocal,
  resolveMemoryTimeZone,
} from '../src/services/memories-rules.js';

const TRIP_TIME_ZONE = 'Asia/Singapore';

function resolve(overrides: Partial<Parameters<typeof resolveMemoryTimeZone>[0]>) {
  return resolveMemoryTimeZone({
    itineraryDayTimeZone: null,
    itineraryItemTimeZone: null,
    tripPlaceTimeZone: null,
    tripTimeZone: TRIP_TIME_ZONE,
    ...overrides,
  });
}

test('resolves memory timezone from item, then Place, then day, then trip reference', () => {
  assert.deepEqual(
    resolve({
      itineraryDayTimeZone: 'Europe/Lisbon',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
    { source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' },
  );
  assert.deepEqual(
    resolve({ itineraryDayTimeZone: 'Europe/Lisbon', tripPlaceTimeZone: 'Australia/Sydney' }),
    { source: 'TRIP_PLACE', timeZone: 'Australia/Sydney' },
  );
  assert.deepEqual(resolve({ itineraryDayTimeZone: 'Europe/Lisbon' }), {
    source: 'ITINERARY_DAY',
    timeZone: 'Europe/Lisbon',
  });
  assert.deepEqual(resolve({}), { source: 'TRIP_REFERENCE', timeZone: TRIP_TIME_ZONE });
});

test('skips unusable timezone identifiers rather than trusting them', () => {
  assert.deepEqual(
    resolve({ itineraryDayTimeZone: 'Europe/Lisbon', itineraryItemTimeZone: 'Not/AZone' }),
    { source: 'ITINERARY_DAY', timeZone: 'Europe/Lisbon' },
  );
});

test('derives the local representation from the authoritative captured instant', () => {
  const instant = new Date('2026-09-05T01:30:00.000Z');

  assert.deepEqual(deriveCapturedLocal(instant, 'Asia/Singapore'), {
    date: '2026-09-05',
    time: '09:30',
  });
  assert.deepEqual(deriveCapturedLocal(instant, 'America/New_York'), {
    date: '2026-09-04',
    time: '21:30',
  });
});

test('surfaces when correcting the timezone moves a memory to another calendar day', () => {
  const instant = new Date('2026-09-05T01:30:00.000Z');
  const acrossMidnight = describeCapturedLocalChange(
    instant,
    { timeZone: 'Asia/Singapore' },
    { timeZone: 'America/New_York' },
  );
  const sameDay = describeCapturedLocalChange(
    instant,
    { timeZone: 'Asia/Singapore' },
    { timeZone: 'Asia/Tokyo' },
  );

  assert.deepEqual(acrossMidnight, {
    after: { date: '2026-09-04', time: '21:30' },
    before: { date: '2026-09-05', time: '09:30' },
    localDateChanged: true,
  });
  assert.equal(sameDay.localDateChanged, false);
  assert.equal(sameDay.after.time, '10:30');
});
