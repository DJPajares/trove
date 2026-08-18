import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { ItineraryDay, ItineraryItem } from '../lib/itinerary/api.ts';
import type { Itinerary } from '../lib/itinerary/api.ts';
import { itineraryDayRouteRevision, itineraryPlanScoreRevision } from '../lib/itinerary/routes.ts';

function item(id: string, position: number): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: null,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day-1',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
  } as ItineraryItem;
}

function day(items: ItineraryItem[]): ItineraryDay {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: '2026-09-05',
    defaultTimeZone: 'Pacific/Auckland',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: 'day-1',
    items,
    notes: null,
    routeStartTravelMode: 'drive',
  } as ItineraryDay;
}

/**
 * The invariant the offline route cache now depends on. A day's legs are a chain
 * between adjacent stops, so a payload computed for one ordering is wrong for
 * another — if reordering left this signature unchanged, the cache would serve
 * the previous chain back as though it were current.
 */
test('reordering a day changes its route revision', () => {
  const before = itineraryDayRouteRevision(day([item('a', 0), item('b', 1), item('c', 2)]));
  const after = itineraryDayRouteRevision(day([item('a', 0), item('c', 1), item('b', 2)]));

  assert.notEqual(before, after);
});

test('the same day in the same order has the same route revision', () => {
  assert.equal(
    itineraryDayRouteRevision(day([item('a', 0), item('b', 1)])),
    itineraryDayRouteRevision(day([item('a', 0), item('b', 1)])),
  );
});

test('changing the day base changes the revision, since it moves the boundary legs', () => {
  const base = day([item('a', 0)]);

  assert.notEqual(
    itineraryDayRouteRevision(base),
    itineraryDayRouteRevision({ ...base, dailyBaseTripPlaceId: 'hotel-a' }),
  );
});

test('a day with no items still has a stable revision, and no day has none', () => {
  assert.equal(itineraryDayRouteRevision(null), '');
  assert.notEqual(itineraryDayRouteRevision(day([])), '');
});

function itinerary(items: ItineraryItem[]): Itinerary {
  return { days: [day(items)] } as Itinerary;
}

/**
 * Scoring a trip costs a provider request for every place on every day. Keying
 * it on a whole item meant editing a note re-scored the entire trip, which is
 * how a few minutes of ordinary editing turned into thousands of billed calls.
 */
test('editing a field the score cannot read does not re-score the trip', () => {
  const before = itinerary([item('a', 0)]);
  const edited = itinerary([
    { ...item('a', 0), notes: 'bring cash', updatedAt: '2026-09-06T00:00:00.000Z' },
  ]);

  assert.equal(itineraryPlanScoreRevision(before), itineraryPlanScoreRevision(edited));
});

test('changing when or how long an item runs does re-score the trip', () => {
  const before = itinerary([item('a', 0)]);

  assert.notEqual(
    itineraryPlanScoreRevision(before),
    itineraryPlanScoreRevision(itinerary([{ ...item('a', 0), localStartTime: '09:00' }])),
  );
  assert.notEqual(
    itineraryPlanScoreRevision(before),
    itineraryPlanScoreRevision(itinerary([{ ...item('a', 0), durationMinutes: 90 }])),
  );
  assert.notEqual(
    itineraryPlanScoreRevision(before),
    itineraryPlanScoreRevision(itinerary([{ ...item('a', 0), dayPart: 'morning' }])),
  );
});

test('reordering a day re-scores the trip, since the legs change', () => {
  assert.notEqual(
    itineraryPlanScoreRevision(itinerary([item('a', 0), item('b', 1)])),
    itineraryPlanScoreRevision(itinerary([item('b', 0), item('a', 1)])),
  );
});
