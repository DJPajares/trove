import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveTripLifecycle,
  enumerateDateRange,
  getDateRangeChanges,
  isValidIanaTimeZone,
  resolveTripTimeZone,
} from '../src/services/trip-rules.js';

test('derives lifecycle from the persisted trip timezone with inclusive date boundaries', () => {
  const instant = new Date('2026-08-10T15:00:00.000Z');

  assert.equal(deriveTripLifecycle('2026-08-11', '2026-08-12', 'Asia/Tokyo', instant), 'active');
  assert.equal(
    deriveTripLifecycle('2026-08-11', '2026-08-12', 'America/New_York', instant),
    'planning',
  );
  assert.equal(
    deriveTripLifecycle(
      '2026-08-09',
      '2026-08-10',
      'Asia/Tokyo',
      new Date('2026-08-10T16:00:00.000Z'),
    ),
    'completed',
  );
});

test('enumerates every inclusive itinerary date and rejects inverted ranges', () => {
  assert.deepEqual(enumerateDateRange('2026-08-10', '2026-08-12'), [
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
  ]);
  assert.throws(() => enumerateDateRange('2026-08-12', '2026-08-10'), /invalid_date_range/);
  assert.throws(() => enumerateDateRange('2026-02-30', '2026-03-02'), /invalid_date/);
});

test('separates removed, retained, and newly expanded itinerary dates', () => {
  assert.deepEqual(
    getDateRangeChanges(['2026-08-10', '2026-08-11', '2026-08-12'], '2026-08-11', '2026-08-14'),
    {
      missingDates: ['2026-08-13', '2026-08-14'],
      removedDates: ['2026-08-10'],
      retainedDates: ['2026-08-11', '2026-08-12'],
    },
  );
});

test('resolves reference timezone in the PRD fallback order', () => {
  const common = {
    destinations: [
      { placeId: 'destination-unresolved', timeZone: null },
      { placeId: 'destination-resolved', timeZone: 'Asia/Tokyo' },
    ],
    deviceTimeZone: 'Asia/Singapore',
    profileHome: { placeId: 'home', timeZone: 'Australia/Sydney' },
    startingLocation: { placeId: 'start', timeZone: 'Europe/Paris' },
  };

  assert.deepEqual(resolveTripTimeZone({ ...common, explicitTimeZone: 'America/New_York' }), {
    source: 'EXPLICIT',
    sourcePlaceId: null,
    timeZone: 'America/New_York',
  });
  assert.deepEqual(resolveTripTimeZone(common), {
    source: 'DESTINATION',
    sourcePlaceId: 'destination-resolved',
    timeZone: 'Asia/Tokyo',
  });
  assert.deepEqual(resolveTripTimeZone({ ...common, destinations: [] }), {
    source: 'STARTING_LOCATION',
    sourcePlaceId: 'start',
    timeZone: 'Europe/Paris',
  });
  assert.deepEqual(resolveTripTimeZone({ ...common, destinations: [], startingLocation: null }), {
    source: 'PROFILE_HOME',
    sourcePlaceId: 'home',
    timeZone: 'Australia/Sydney',
  });
  assert.deepEqual(
    resolveTripTimeZone({
      ...common,
      destinations: [],
      profileHome: null,
      startingLocation: null,
    }),
    {
      source: 'DEVICE_FALLBACK',
      sourcePlaceId: null,
      timeZone: 'Asia/Singapore',
    },
  );
});

test('accepts IANA timezone identifiers and safely rejects invalid values', () => {
  assert.equal(isValidIanaTimeZone('Asia/Singapore'), true);
  assert.equal(isValidIanaTimeZone('UTC'), true);
  assert.equal(isValidIanaTimeZone('not-a-timezone'), false);
});
