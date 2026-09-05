import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  DEPARTURE_APPROACH_DAYS,
  departureApproach,
  resolveCountdown,
} from '../lib/trips/lifecycle.ts';

const NOW = new Date('2026-09-01T12:00:00.000Z');

function trip(startDate: string): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2027-12-31',
    experienceNote: null,
    experienceRating: null,
    id: 'trip',
    lifecycle: 'planning',
    memoryCount: 0,
    name: 'A trip',
    partySize: 1,
    planningReadiness: 'ready',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate,
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('the last week counts in days', () => {
  expect(resolveCountdown(0)).toEqual({ unit: 'day', value: 0 });
  expect(resolveCountdown(1)).toEqual({ unit: 'day', value: 1 });
  expect(resolveCountdown(6)).toEqual({ unit: 'day', value: 6 });
});

test('the next couple of months count in weeks', () => {
  expect(resolveCountdown(7)).toEqual({ unit: 'week', value: 1 });
  expect(resolveCountdown(45)).toEqual({ unit: 'week', value: 6 });
  expect(resolveCountdown(69)).toEqual({ unit: 'week', value: 10 });
});

test('anything further out counts in months', () => {
  expect(resolveCountdown(70)).toEqual({ unit: 'month', value: 2 });
  expect(resolveCountdown(365)).toEqual({ unit: 'month', value: 12 });
});

test('a past start date never counts backwards', () => {
  expect(resolveCountdown(-5)).toEqual({ unit: 'day', value: 0 });
});

test('the bar is absent beyond the final approach', () => {
  expect(departureApproach(trip('2026-12-15'), NOW)).toBeNull();
});

test('the bar appears on the day the window opens, empty', () => {
  const start = new Date(NOW);
  start.setUTCDate(start.getUTCDate() + DEPARTURE_APPROACH_DAYS);

  expect(departureApproach(trip(start.toISOString().slice(0, 10)), NOW)).toBe(0);
});

test('the bar fills as departure nears', () => {
  expect(departureApproach(trip('2026-09-16'), NOW)).toBeCloseTo(50);
  expect(departureApproach(trip('2026-09-02'), NOW)).toBeCloseTo((29 / 30) * 100);
});

test('departure day is full, and a started trip stays full rather than overflowing', () => {
  expect(departureApproach(trip('2026-09-01'), NOW)).toBe(100);
  expect(departureApproach(trip('2026-08-20'), NOW)).toBe(100);
});
