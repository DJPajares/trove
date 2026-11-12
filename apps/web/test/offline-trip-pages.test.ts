import { expect, test } from 'vitest';

import {
  isOfflineTripPagePath,
  offlineTripPageUrls,
  pickColdStartTrip,
} from '../lib/offline/trip-pages.ts';

const tripId = '01a12e33-0313-721e-a35d-e67c99079555';

test('every page preparation warms is one the worker will serve offline', () => {
  const urls = offlineTripPageUrls(tripId);
  expect(urls).toContain(`/trips/${tripId}`);
  expect(urls).toContain(`/trips/${tripId}/mode/today`);
  for (const url of urls) expect(isOfflineTripPagePath(url)).toBe(true);
});

test('the trip hub opens offline, with or without a trailing slash', () => {
  expect(isOfflineTripPagePath(`/trips/${tripId}`)).toBe(true);
  expect(isOfflineTripPagePath(`/trips/${tripId}/`)).toBe(true);
});

test('pages outside a trip still need the network', () => {
  for (const path of ['/', '/trips', '/saved', '/trips/archived', '/trips/ai/session-1']) {
    expect(isOfflineTripPagePath(path)).toBe(false);
  }
  expect(isOfflineTripPagePath(`/trips/${tripId}/settings`)).toBe(false);
  expect(isOfflineTripPagePath(`/trips/${tripId}/mode/map/extra`)).toBe(false);
});

const trip = (id: string, startDate: string, endDate: string, extra = {}) => ({
  endDate,
  id,
  referenceTimeZone: 'UTC',
  startDate,
  ...extra,
});

const now = new Date('2026-11-12T10:00:00Z');

test('a launch opens the one trip under way today', () => {
  expect(
    pickColdStartTrip(
      [trip('lisbon', '2026-11-10', '2026-11-15'), trip('kyoto', '2027-03-01', '2027-03-09')],
      now,
    ),
  ).toBe('lisbon');
});

test('a launch chooses nothing when no trip, or more than one, is under way', () => {
  expect(pickColdStartTrip([trip('kyoto', '2027-03-01', '2027-03-09')], now)).toBeNull();
  expect(
    pickColdStartTrip(
      [trip('lisbon', '2026-11-10', '2026-11-15'), trip('porto', '2026-11-12', '2026-11-12')],
      now,
    ),
  ).toBeNull();
});

test('an archived trip is never opened on launch', () => {
  expect(
    pickColdStartTrip(
      [trip('lisbon', '2026-11-10', '2026-11-15', { archivedAt: '2026-11-11T00:00:00Z' })],
      now,
    ),
  ).toBeNull();
});

test('today is judged in the trip’s own time zone', () => {
  // 12:00 UTC on the 12th is already 01:00 on the 13th in Auckland.
  const late = new Date('2026-11-12T12:00:00Z');
  const auckland = trip('auckland', '2026-11-13', '2026-11-20', {
    referenceTimeZone: 'Pacific/Auckland',
  });
  expect(pickColdStartTrip([auckland], late)).toBe('auckland');
  expect(pickColdStartTrip([{ ...auckland, referenceTimeZone: 'UTC' }], late)).toBeNull();
});
