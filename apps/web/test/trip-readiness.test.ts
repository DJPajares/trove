import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import { resolveReadinessPrompt } from '../lib/trips/lifecycle.ts';

const NOW = new Date('2026-09-01T12:00:00.000Z');

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-12-21',
    experienceNote: null,
    experienceRating: null,
    id: 'trip',
    itineraryCoverage: { percentage: 29, plannedDays: 2, totalDays: 7 },
    lifecycle: 'planning',
    memoryCount: 0,
    name: 'A trip',
    partySize: 1,
    planningReadiness: 'in_progress',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate: '2026-12-15',
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    weatherLocation: null,
    ...overrides,
  };
}

test('a plan that is neither complete nor close is left alone', () => {
  expect(resolveReadinessPrompt(trip(), NOW)).toBeNull();
});

test('a fully planned trip is asked whether it is ready', () => {
  const fullyPlanned = trip({
    itineraryCoverage: { percentage: 100, plannedDays: 7, totalDays: 7 },
  });

  expect(resolveReadinessPrompt(fullyPlanned, NOW)).toBe('suggest');
});

test('a trip leaving within the week is reminded that its plan is open', () => {
  expect(resolveReadinessPrompt(trip({ startDate: '2026-09-05' }), NOW)).toBe('nudge');
});

test('a trip leaving just outside the window says nothing yet', () => {
  expect(resolveReadinessPrompt(trip({ startDate: '2026-09-09' }), NOW)).toBeNull();
});

test('a complete plan is asked rather than reminded when both would apply', () => {
  const both = trip({
    itineraryCoverage: { percentage: 100, plannedDays: 7, totalDays: 7 },
    startDate: '2026-09-03',
  });

  expect(resolveReadinessPrompt(both, NOW)).toBe('suggest');
});

test('a trip already marked Ready is never prompted', () => {
  const ready = trip({
    itineraryCoverage: { percentage: 100, plannedDays: 7, totalDays: 7 },
    planningReadiness: 'ready',
    startDate: '2026-09-03',
  });

  expect(resolveReadinessPrompt(ready, NOW)).toBeNull();
});

test('readiness is a planning-phase question, so travelled and finished trips are silent', () => {
  const shape = {
    itineraryCoverage: { percentage: 100, plannedDays: 7, totalDays: 7 },
    startDate: '2026-08-25',
  } as const;

  expect(resolveReadinessPrompt(trip({ ...shape, lifecycle: 'active' }), NOW)).toBeNull();
  expect(resolveReadinessPrompt(trip({ ...shape, lifecycle: 'completed' }), NOW)).toBeNull();
});

test('a trip with no itinerary coverage yet is not treated as complete', () => {
  expect(resolveReadinessPrompt(trip({ itineraryCoverage: undefined }), NOW)).toBeNull();
});
