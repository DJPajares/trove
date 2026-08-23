import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  editorialCoverSubjectName,
  hasOptionalTripDetails,
  isValidPartySize,
} from '../lib/trips/form.ts';

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    coverPhotoPath: null,
    coverPhotoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    id: 'trip-1',
    lifecycle: 'planning',
    memoryCount: 0,
    name: 'A trip',
    notes: null,
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

test('a new trip has nothing hidden, so the panel stays closed', () => {
  expect(hasOptionalTripDetails(null)).toBe(false);
  expect(hasOptionalTripDetails(trip())).toBe(false);
});

test('anything the traveller already filled in opens the panel', () => {
  expect(hasOptionalTripDetails(trip({ notes: 'Bring the good camera' }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ startingLocationOverride: 'Manila' }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ referenceTimeZoneSource: 'explicit' }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ partySize: 2 }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ planningReadiness: 'ready' }))).toBe(true);
});

test('whitespace is not content', () => {
  expect(hasOptionalTripDetails(trip({ notes: '   ' }))).toBe(false);
  expect(hasOptionalTripDetails(trip({ startingLocationOverride: '  ' }))).toBe(false);
});

test('a travel party is a whole number of people, at least one', () => {
  expect(isValidPartySize('1')).toBe(true);
  expect(isValidPartySize('99')).toBe(true);
  expect(isValidPartySize('0')).toBe(false);
  expect(isValidPartySize('100')).toBe(false);
  expect(isValidPartySize('1.5')).toBe(false);
  expect(isValidPartySize('')).toBe(false);
  expect(isValidPartySize('abc')).toBe(false);
});

test('the cover preview asks about the first destination, falling back to the trip', () => {
  expect(editorialCoverSubjectName(['Kyoto', 'Osaka'], 'Spring in Japan')).toBe('Kyoto');
  expect(editorialCoverSubjectName(['  ', 'Osaka'], 'Spring in Japan')).toBe('Osaka');
  expect(editorialCoverSubjectName([], 'Spring in Japan')).toBe('Spring in Japan');
  expect(editorialCoverSubjectName(['  Kyoto  '], 'Spring in Japan')).toBe('Kyoto');
});

test('a half-typed name asks for nothing', () => {
  // Otherwise every keystroke on the way to "Kyoto" is its own question.
  expect(editorialCoverSubjectName(['Ky'], '')).toBe('');
  expect(editorialCoverSubjectName([], '  ')).toBe('');
  expect(editorialCoverSubjectName(['Kyo'], '')).toBe('Kyo');
});
