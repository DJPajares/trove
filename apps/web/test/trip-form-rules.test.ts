import { expect, test } from 'vitest';

import type { Trip } from '../lib/trips/api.ts';
import {
  editorialCoverSubjectName,
  hasOptionalTripDetails,
  hasTripCountries,
  isValidPartySize,
  moveTripRange,
  shiftTripDates,
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

test('moving the start date carries the end date with it', () => {
  // The trip is not being made shorter or longer, it is happening later.
  expect(moveTripRange({ endDate: '2026-09-21', startDate: '2026-09-15' }, '2026-09-22')).toEqual({
    endDate: '2026-09-28',
    startDate: '2026-09-22',
  });
});

test('a trip moved earlier keeps its length too', () => {
  expect(moveTripRange({ endDate: '2026-09-21', startDate: '2026-09-15' }, '2026-09-08')).toEqual({
    endDate: '2026-09-14',
    startDate: '2026-09-08',
  });
});

test('a move across a month boundary counts days, not dates', () => {
  expect(moveTripRange({ endDate: '2026-09-30', startDate: '2026-09-28' }, '2026-10-30')).toEqual({
    endDate: '2026-11-01',
    startDate: '2026-10-30',
  });
});

test('a single-day trip stays a single day', () => {
  expect(moveTripRange({ endDate: '2026-09-15', startDate: '2026-09-15' }, '2026-12-01')).toEqual({
    endDate: '2026-12-01',
    startDate: '2026-12-01',
  });
});

test('a range that cannot be read is not guessed at', () => {
  // The form's own validation owns this case; inventing an end date here would
  // only bury the thing the traveller needs to see.
  expect(moveTripRange({ endDate: '', startDate: '' }, '2026-09-22')).toEqual({
    endDate: '',
    startDate: '2026-09-22',
  });
});

test('shifting a trip moves both ends by the same number of days', () => {
  expect(shiftTripDates({ endDate: '2026-09-21', startDate: '2026-09-15' }, 7)).toEqual({
    endDate: '2026-09-28',
    startDate: '2026-09-22',
  });
  expect(shiftTripDates({ endDate: '2026-09-21', startDate: '2026-09-15' }, -7)).toEqual({
    endDate: '2026-09-14',
    startDate: '2026-09-08',
  });
});

test('a shift counts days, not dates, across month and year boundaries', () => {
  expect(shiftTripDates({ endDate: '2026-10-02', startDate: '2026-09-30' }, 1)).toEqual({
    endDate: '2026-10-03',
    startDate: '2026-10-01',
  });
  expect(shiftTripDates({ endDate: '2026-01-02', startDate: '2025-12-31' }, -1)).toEqual({
    endDate: '2026-01-01',
    startDate: '2025-12-30',
  });
});

test('a shift over a leap day lands a day later than the calendar reads', () => {
  // 2028 has a 29 February, so a week from the 26th is 4 March.
  expect(shiftTripDates({ endDate: '2028-02-27', startDate: '2028-02-26' }, 7)).toEqual({
    endDate: '2028-03-05',
    startDate: '2028-03-04',
  });
});

test('a trip that is not going anywhere is left alone', () => {
  expect(shiftTripDates({ endDate: '2026-09-21', startDate: '2026-09-15' }, 0)).toEqual({
    endDate: '2026-09-21',
    startDate: '2026-09-15',
  });
  expect(shiftTripDates({ endDate: '', startDate: '' }, 7)).toEqual({
    endDate: '',
    startDate: '',
  });
});

test('a trip has named where it goes once it carries a country', () => {
  expect(hasTripCountries(['NZ'])).toBe(true);
  expect(hasTripCountries(['VN', 'TH'])).toBe(true);
});

/**
 * The picker cannot produce a blank, but form state is rehydrated from trips
 * that predate the field, so an empty list and a list of nothing both arrive.
 */
test('a trip with no country has not', () => {
  expect(hasTripCountries([])).toBe(false);
  expect(hasTripCountries([''])).toBe(false);
  expect(hasTripCountries(['  '])).toBe(false);
});
