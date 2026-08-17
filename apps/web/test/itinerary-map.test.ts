import assert from 'node:assert/strict';
import { test } from 'vitest';

import type {
  ItineraryDay,
  ItineraryItem,
  ItineraryRouteSegment,
  ItineraryTripPlace,
} from '../lib/itinerary/api.ts';
import { dayStopNumbers, resolveDailyBases } from '../lib/itinerary/day-sequence.ts';
import {
  buildItineraryMapPoints,
  dailyBasePoints,
  type ItineraryMapPoint,
  viewportPoints,
} from '../lib/maps/itinerary-map.ts';

function tripPlace(id: string): ItineraryTripPlace {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'custom',
      location: { latitude: 35.7, longitude: 139.8, timeZone: null },
      name: id,
      note: null,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
      timeZone: null,
    },
    priority: null,
  } as ItineraryTripPlace;
}

function item(id: string, placeId: string | null): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: placeId ? null : id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelStatus: 'upcoming',
    tripPlace: placeId ? tripPlace(placeId) : null,
    updatedAt: '2026-09-05T00:00:00.000Z',
  } as ItineraryItem;
}

function day(input: Partial<ItineraryDay> & Pick<ItineraryDay, 'items'>): ItineraryDay {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: '2026-09-05',
    defaultTimeZone: 'Asia/Tokyo',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: 'day',
    notes: null,
    routeStartTravelMode: 'walk',
    ...input,
  } as ItineraryDay;
}

function baseSegment(
  input: Partial<ItineraryRouteSegment> & Pick<ItineraryRouteSegment, 'destination' | 'origin'>,
): ItineraryRouteSegment {
  return {
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    id: 'segment',
    mode: 'walk',
    modeOwner: { id: 'day', kind: 'day_start' },
    provider: null,
    reason: null,
    scope: 'local',
    status: 'ok',
    ...input,
  } as ItineraryRouteSegment;
}

function basePointsFor(input: {
  day: Partial<ItineraryDay>;
  itemCount?: number;
  routeSegments?: ItineraryRouteSegment[];
  scheduled?: string[];
  tripPlaces: string[];
}) {
  const bases = resolveDailyBases({
    day: day({ items: [], ...input.day }),
    routeSegments: input.routeSegments,
  });
  return dailyBasePoints({
    bases,
    numbers: dayStopNumbers({ bases, itemCount: input.itemCount ?? 0 }),
    resolvePlaceLocation: (place) => place.place.location,
    resolvePlaceName: (place) => place.id,
    scheduledTripPlaceIds: new Set(input.scheduled ?? []),
    tripPlaces: input.tripPlaces.map(tripPlace),
  });
}

function point(id: string, kind: ItineraryMapPoint['kind']): ItineraryMapPoint {
  return {
    id,
    itemId: null,
    kind,
    latitude: 35.7,
    longitude: 139.8,
    name: id,
    order: null,
    tripPlaceId: id,
  };
}

test('a considered Place far from the day never stretches the frame', () => {
  const points = [
    point('senso-ji', 'scheduled'),
    point('shinjuku', 'scheduled'),
    point('rotorua', 'considered'),
  ];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['senso-ji', 'shinjuku'],
  );
});

test('the day base frames the day alongside its scheduled stops', () => {
  const points = [
    point('ryokan', 'base'),
    point('museum', 'scheduled'),
    point('far', 'considered'),
  ];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['ryokan', 'museum'],
  );
});

test('a day with nothing located falls back to every point rather than framing nothing', () => {
  const points = [point('one', 'considered'), point('two', 'considered')];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['one', 'two'],
  );
});

test('an empty map has nothing to frame', () => {
  assert.deepEqual(viewportPoints([]), []);
});

test('one base serves a day that starts and ends in the same place', () => {
  const points = basePointsFor({
    day: { dailyBaseTripPlaceId: 'ryokan' },
    tripPlaces: ['ryokan', 'museum'],
  });

  assert.deepEqual(
    points.map((entry) => [entry.id, entry.baseRole, entry.kind, entry.order]),
    [['base:both:ryokan', 'both', 'base', 1]],
  );
});

test('the base the day leaves from is its first stop, and the stops after it move down', () => {
  const bases = { arrivalTripPlaceId: 'ryokan', departureTripPlaceId: 'ryokan' };

  assert.deepEqual(dayStopNumbers({ bases, itemCount: 3 }), {
    arrival: 1,
    // A day that comes home ends on a stop it has already counted.
    departure: null,
    itemOffset: 1,
  });
});

test('a day that ends somewhere new counts that base as its last stop', () => {
  const bases = { arrivalTripPlaceId: 'ryokan', departureTripPlaceId: 'hostel' };

  assert.deepEqual(dayStopNumbers({ bases, itemCount: 3 }), {
    arrival: 1,
    departure: 5,
    itemOffset: 1,
  });
});

test('a day with no base to leave from starts counting at its first item', () => {
  const bases = { arrivalTripPlaceId: null, departureTripPlaceId: null };

  assert.deepEqual(dayStopNumbers({ bases, itemCount: 3 }), {
    arrival: null,
    departure: null,
    itemOffset: 0,
  });
});

test('a day that only has somewhere to end still numbers its items from one', () => {
  const bases = { arrivalTripPlaceId: null, departureTripPlaceId: 'hostel' };

  assert.deepEqual(dayStopNumbers({ bases, itemCount: 2 }), {
    arrival: null,
    departure: 3,
    itemOffset: 0,
  });
});

test('items on a day with a base are numbered after it on the map too', () => {
  const points = buildItineraryMapPoints({
    itinerary: { tripPlaces: [], unscheduledItems: [] },
    orderOffset: 1,
    resolveItemName: (entry) => entry.id,
    resolvePlaceName: (place) => place.id,
    selectedDay: { items: [item('first', 'shrine'), item('second', 'market')] },
  });

  assert.deepEqual(
    points.map((entry) => [entry.tripPlaceId, entry.order]),
    [
      ['shrine', 2],
      ['market', 3],
    ],
  );
});

test('a day that moves on gets a marker at each end, numbered first and last', () => {
  const points = basePointsFor({
    day: { dailyBaseDepartureTripPlaceId: 'hostel', dailyBaseTripPlaceId: 'ryokan' },
    itemCount: 2,
    tripPlaces: ['ryokan', 'hostel'],
  });

  assert.deepEqual(
    points.map((entry) => [entry.baseRole, entry.tripPlaceId, entry.order]),
    [
      ['arrival', 'ryokan', 1],
      ['departure', 'hostel', 4],
    ],
  );
});

test('a base that is already a stop on the day needs no second marker', () => {
  const points = basePointsFor({
    day: { dailyBaseTripPlaceId: 'ryokan' },
    scheduled: ['ryokan'],
    tripPlaces: ['ryokan'],
  });

  assert.deepEqual(points, []);
});

test('a base inferred from the day route still reaches the map', () => {
  const points = basePointsFor({
    day: {},
    routeSegments: [
      baseSegment({
        destination: { id: 'senso-ji', kind: 'itinerary_item', label: null },
        origin: { id: 'ryokan', kind: 'daily_base', label: 'Ryokan' },
      }),
      baseSegment({
        destination: { id: 'ryokan', kind: 'daily_base', label: 'Ryokan' },
        id: 'return',
        modeOwner: { id: 'senso-ji', kind: 'item_departure' },
        origin: { id: 'senso-ji', kind: 'itinerary_item', label: null },
      }),
    ],
    tripPlaces: ['ryokan'],
  });

  assert.deepEqual(
    points.map((entry) => [entry.baseRole, entry.tripPlaceId]),
    [['both', 'ryokan']],
  );
});

test('a starting location is not mistaken for a daily base', () => {
  const points = basePointsFor({
    day: {},
    routeSegments: [
      baseSegment({
        destination: { id: 'senso-ji', kind: 'itinerary_item', label: null },
        origin: { id: 'home', kind: 'starting_location', label: 'Home' },
      }),
    ],
    tripPlaces: ['home'],
  });

  assert.deepEqual(points, []);
});

test('a Place off this day says which days already have it', () => {
  const points = buildItineraryMapPoints({
    itinerary: { tripPlaces: [tripPlace('shrine'), tripPlace('market')], unscheduledItems: [] },
    placeUse: {
      market: { dayNumbers: [2], itemCount: 1, unscheduledCount: 0 },
      shrine: { dayNumbers: [1, 3], itemCount: 2, unscheduledCount: 0 },
    },
    resolveItemName: (entry) => entry.id,
    resolvePlaceName: (place) => place.id,
    selectedDay: { items: [] },
    selectedDayNumber: 2,
  });

  assert.deepEqual(
    points.map((entry) => [entry.tripPlaceId, entry.otherDayNumbers]),
    [
      ['shrine', [1, 3]],
      // Its own day is where you already are, so it goes unsaid.
      ['market', undefined],
    ],
  );
});

test('a scheduled stop keeps its number and carries no cross-day note', () => {
  const points = buildItineraryMapPoints({
    itinerary: { tripPlaces: [tripPlace('shrine')], unscheduledItems: [] },
    placeUse: { shrine: { dayNumbers: [1, 2], itemCount: 2, unscheduledCount: 0 } },
    resolveItemName: (entry) => entry.id,
    resolvePlaceName: (place) => place.id,
    selectedDay: { items: [item('visit', 'shrine')] },
    selectedDayNumber: 2,
  });

  assert.deepEqual(
    points.map((entry) => [entry.kind, entry.order, entry.otherDayNumbers]),
    [['scheduled', 1, undefined]],
  );
});
