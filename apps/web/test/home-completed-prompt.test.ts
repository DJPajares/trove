import { expect, test } from 'vitest';

import { selectCompletedPrompt } from '../lib/home/completed-prompt.ts';
import type { Trip } from '../lib/trips/api.ts';

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    description: null,
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    id: 'trip-1',
    lifecycle: 'completed',
    memoryCount: 0,
    name: 'A trip',
    partySize: 1,
    planningReadiness: 'in_progress',
    referenceTimeZone: 'UTC',
    referenceTimeZoneSource: 'device_fallback',
    startDate: '2026-09-05',
    startingLocation: null,
    startingLocationOverride: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('a trip still being planned or travelled is never nudged', () => {
  expect(selectCompletedPrompt(null, [])).toBeNull();
  expect(selectCompletedPrompt(trip({ lifecycle: 'planning' }), [])).toBeNull();
  expect(selectCompletedPrompt(trip({ lifecycle: 'active' }), [])).toBeNull();
});

test('a traveller who said no is not asked again', () => {
  expect(selectCompletedPrompt(trip({ id: 'trip-1' }), ['trip-1'])).toBeNull();
  expect(selectCompletedPrompt(trip({ id: 'trip-1' }), ['other-trip'])).toBe('completedPrompt');
});

test('the nudge names only what is actually still missing', () => {
  expect(selectCompletedPrompt(trip({ experienceRating: null, memoryCount: 0 }), [])).toBe(
    'completedPrompt',
  );
  expect(selectCompletedPrompt(trip({ experienceRating: 4, memoryCount: 0 }), [])).toBe(
    'completedPromptMemories',
  );
  expect(selectCompletedPrompt(trip({ experienceRating: null, memoryCount: 3 }), [])).toBe(
    'completedPromptRating',
  );
  expect(selectCompletedPrompt(trip({ experienceRating: 4, memoryCount: 3 }), [])).toBeNull();
});

test('rating a trip poorly still counts as having rated it', () => {
  // The difference between "no rating yet" and "rated it zero" is the whole
  // reason this tests absence rather than falsiness.
  expect(selectCompletedPrompt(trip({ experienceRating: 0, memoryCount: 3 }), [])).toBeNull();
  expect(selectCompletedPrompt(trip({ experienceRating: 0, memoryCount: 0 }), [])).toBe(
    'completedPromptMemories',
  );
});
