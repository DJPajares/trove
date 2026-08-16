import assert from 'node:assert/strict';
import test from 'node:test';

import { createSummary, type ItineraryRouteSegment } from '../src/services/itinerary-routes.js';

function localSegment(id: string, durationSeconds: number | null): ItineraryRouteSegment {
  return {
    destination: { id: `${id}-to`, kind: 'itinerary_item', label: null },
    distanceMeters: durationSeconds === null ? null : 1000,
    durationSeconds,
    encodedPolyline: null,
    id,
    mode: 'drive',
    modeOwner: { id: 'day-1', kind: 'day_start' },
    origin: { id: `${id}-from`, kind: 'itinerary_item', label: null },
    provider: 'google',
    reason: durationSeconds === null ? 'route_not_found' : null,
    scope: 'local',
    status: durationSeconds === null ? 'unavailable' : 'ok',
  };
}

function flightSegment(id: string): ItineraryRouteSegment {
  return {
    destination: { id: `${id}-to`, kind: 'itinerary_item', label: null },
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    id,
    mode: 'flight',
    modeOwner: { id: 'day-1', kind: 'day_start' },
    origin: { id: `${id}-from`, kind: 'itinerary_item', label: null },
    provider: null,
    reason: null,
    scope: 'long_distance',
    status: 'not_estimated',
  };
}

test('totals cover every local leg when all of them are known', () => {
  const summary = createSummary([localSegment('a', 600), localSegment('b', 1200)], 3, false);

  assert.equal(summary.status, 'complete');
  assert.equal(summary.durationSeconds, 1800);
  assert.equal(summary.distanceMeters, 2000);
  assert.equal(summary.localSegmentCount, 2);
  assert.equal(summary.knownSegmentCount, 2);
});

test('a flight alongside local legs leaves the day complete, not partial', () => {
  // The reported defect: routing a long-distance hop as a drive returned nothing
  // and dragged the whole day's summary into a permanent partial state.
  const withFlight = createSummary([localSegment('a', 600), flightSegment('f')], 3, false);
  const withFailedRoute = createSummary(
    [localSegment('a', 600), localSegment('f', null)],
    3,
    false,
  );

  assert.equal(withFlight.status, 'complete');
  assert.equal(withFailedRoute.status, 'partial');
});

test('a flight contributes nothing to the totals', () => {
  const withFlight = createSummary([localSegment('a', 600), flightSegment('f')], 3, false);
  const localOnly = createSummary([localSegment('a', 600)], 3, false);

  assert.equal(withFlight.durationSeconds, localOnly.durationSeconds);
  assert.equal(withFlight.distanceMeters, localOnly.distanceMeters);
  assert.equal(withFlight.localSegmentCount, 1);
  // Every leg is still counted, so the day knows it has movement to show.
  assert.equal(withFlight.totalSegmentCount, 2);
});

test('a day whose only movement is a flight reports no local legs', () => {
  const summary = createSummary([flightSegment('f')], 2, false);

  // localSegmentCount 0 against a non-zero total is what lets the UI say "no
  // local travel" rather than presenting 0 min / 0 km as a real estimate.
  assert.equal(summary.localSegmentCount, 0);
  assert.equal(summary.totalSegmentCount, 1);
});

test('a day with nothing scheduled is not mistaken for a long-distance day', () => {
  const summary = createSummary([], 0, false);

  assert.equal(summary.localSegmentCount, 0);
  assert.equal(summary.totalSegmentCount, 0);
});

test('missing coordinates keep the day partial even when every known leg resolved', () => {
  const summary = createSummary([localSegment('a', 600)], 3, true);

  assert.equal(summary.status, 'partial');
});
