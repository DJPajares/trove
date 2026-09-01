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
    description: null,
    destinations: [],
    endDate: '2026-09-21',
    experienceNote: null,
    experienceRating: null,
    id: 'trip-1',
    lifecycle: 'planning',
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

test('a new trip has nothing hidden, so the panel stays closed', () => {
  expect(hasOptionalTripDetails(null)).toBe(false);
  expect(hasOptionalTripDetails(trip())).toBe(false);
});

test('anything the traveller already filled in opens the panel', () => {
  expect(hasOptionalTripDetails(trip({ startingLocationOverride: 'Manila' }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ referenceTimeZoneSource: 'explicit' }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ partySize: 2 }))).toBe(true);
  expect(hasOptionalTripDetails(trip({ planningReadiness: 'ready' }))).toBe(true);
});

test('whitespace is not content', () => {
  expect(hasOptionalTripDetails(trip({ startingLocationOverride: '  ' }))).toBe(false);
});

// The description is asked for in the form's main body, so it must not drag the
// optional panel open behind it.
test('a description is not what this panel holds', () => {
  expect(hasOptionalTripDetails(trip({ description: 'Cherry blossom season' }))).toBe(false);
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

test('the cover preview asks about the first destination', () => {
  expect(editorialCoverSubjectName(['Kyoto', 'Osaka'])).toBe('Kyoto');
  expect(editorialCoverSubjectName(['  ', 'Osaka'])).toBe('Osaka');
  expect(editorialCoverSubjectName(['  Kyoto  '])).toBe('Kyoto');
});

test('a trip with no destination is not pictured by its name', () => {
  // A trip called "Validation probe" resolved a photograph of an ultrasound
  // machine, captioned as a travel photograph of it. A name is whatever the
  // traveller felt like; only a place should be searched for.
  expect(editorialCoverSubjectName([])).toBe('');
});

test('a half-typed destination asks for nothing', () => {
  // Otherwise every keystroke on the way to "Kyoto" is its own question.
  expect(editorialCoverSubjectName(['Ky'])).toBe('');
  expect(editorialCoverSubjectName(['  '])).toBe('');
  expect(editorialCoverSubjectName(['Kyo'])).toBe('Kyo');
});
