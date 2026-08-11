import assert from 'node:assert/strict';
import test from 'node:test';

import {
  floatingLocalTimeToInstant,
  formatLocalTime,
  parseLocalTime,
  resolveDayTimeZone,
  resolveItemTimeZone,
  resolveTaskTimeZone,
} from '../src/services/itinerary-rules.js';

test('persists a floating local plan as a deterministic derived instant', () => {
  assert.equal(
    floatingLocalTimeToInstant('2026-08-12', '09:30', 'Asia/Singapore').toISOString(),
    '2026-08-12T01:30:00.000Z',
  );
  assert.equal(formatLocalTime(parseLocalTime('09:30')), '09:30');
});

test('rejects local civil times that do not exist during a daylight-saving jump', () => {
  assert.throws(
    () => floatingLocalTimeToInstant('2026-03-08', '02:30', 'America/New_York'),
    /invalid_local_time/,
  );
});

test('resolves item timezone from location, Place, then persisted day context', () => {
  assert.deepEqual(
    resolveItemTimeZone({
      customLocationTimeZone: 'Pacific/Auckland',
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
    { source: 'EXPLICIT', timeZone: 'Pacific/Auckland' },
  );
  assert.deepEqual(
    resolveItemTimeZone({
      customLocationTimeZone: null,
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
    { source: 'PLACE', timeZone: 'Australia/Sydney' },
  );
  assert.deepEqual(
    resolveItemTimeZone({
      customLocationTimeZone: null,
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: null,
    }),
    { source: 'DAY_DEFAULT', timeZone: 'Asia/Singapore' },
  );
});

test('resolves a day from daily base, first ordered located item, then trip timezone', () => {
  const items = [
    {
      customLocationTimeZone: null,
      id: 'unresolved',
      tripPlaceId: null,
      tripPlaceTimeZone: null,
    },
    {
      customLocationTimeZone: 'Pacific/Auckland',
      id: 'located',
      tripPlaceId: null,
      tripPlaceTimeZone: null,
    },
  ];

  assert.deepEqual(
    resolveDayTimeZone({
      dailyBase: { timeZone: 'Australia/Sydney', tripPlaceId: 'base' },
      items,
      tripTimeZone: 'Asia/Singapore',
    }),
    {
      source: 'EXPLICIT_DAILY_BASE',
      sourceItemId: null,
      sourceTripPlaceId: 'base',
      timeZone: 'Australia/Sydney',
    },
  );
  assert.deepEqual(resolveDayTimeZone({ dailyBase: null, items, tripTimeZone: 'Asia/Singapore' }), {
    source: 'FIRST_LOCATED_ITEM',
    sourceItemId: 'located',
    sourceTripPlaceId: null,
    timeZone: 'Pacific/Auckland',
  });
  assert.deepEqual(
    resolveDayTimeZone({ dailyBase: null, items: [], tripTimeZone: 'Asia/Singapore' }),
    {
      source: 'TRIP_REFERENCE',
      sourceItemId: null,
      sourceTripPlaceId: null,
      timeZone: 'Asia/Singapore',
    },
  );
});

test('resolves task timezone from its item, then day, then trip reference', () => {
  assert.deepEqual(
    resolveTaskTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripTimeZone: 'Europe/London',
    }),
    { source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' },
  );
  assert.deepEqual(
    resolveTaskTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: null,
      tripTimeZone: 'Europe/London',
    }),
    { source: 'ITINERARY_DAY', timeZone: 'Asia/Singapore' },
  );
  assert.deepEqual(
    resolveTaskTimeZone({
      itineraryDayTimeZone: null,
      itineraryItemTimeZone: null,
      tripTimeZone: 'Europe/London',
    }),
    { source: 'TRIP_REFERENCE', timeZone: 'Europe/London' },
  );
});
