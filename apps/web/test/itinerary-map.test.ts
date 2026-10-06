import { expect, test } from 'vitest';

import type {
  ItineraryDay,
  ItineraryItem,
  ItineraryRouteSegment,
  ItineraryTripPlace,
} from '../lib/itinerary/api.ts';
import { dayStopNumbers, resolveDailyBases } from '../lib/itinerary/day-sequence.ts';
import {
  buildItineraryMapPoints,
  buildTripMapPoints,
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

  expect(viewportPoints(points).map((entry) => entry.id)).toStrictEqual(['senso-ji', 'shinjuku']);
});

test('the day base frames the day alongside its scheduled stops', () => {
  const points = [
    point('ryokan', 'base'),
    point('museum', 'scheduled'),
    point('far', 'considered'),
  ];

  expect(viewportPoints(points).map((entry) => entry.id)).toStrictEqual(['ryokan', 'museum']);
});

test('a day with nothing located falls back to every point rather than framing nothing', () => {
  const points = [point('one', 'considered'), point('two', 'considered')];

  expect(viewportPoints(points).map((entry) => entry.id)).toStrictEqual(['one', 'two']);
});

test('an empty map has nothing to frame', () => {
  expect(viewportPoints([])).toStrictEqual([]);
});

test('one base serves a day that starts and ends in the same place', () => {
  const points = basePointsFor({
    day: { dailyBaseTripPlaceId: 'ryokan' },
    tripPlaces: ['ryokan', 'museum'],
  });

  expect(points.map((entry) => [entry.id, entry.baseRole, entry.kind, entry.order])).toStrictEqual([
    ['base:both:ryokan', 'both', 'base', 1],
  ]);
});

test('the base the day leaves from is its first stop, and the stops after it move down', () => {
  const bases = { arrivalTripPlaceId: 'ryokan', departureTripPlaceId: null };

  expect(dayStopNumbers({ bases, itemCount: 3 })).toStrictEqual({
    arrival: 1,
    departure: null,
    itemOffset: 1,
  });
});

test('a day that returns to the same base it left counts the return as its own stop', () => {
  // Leaving in the morning and returning at night are two different moments in
  // the day, not one stop repeated — the same base is stop one and stop five.
  const bases = { arrivalTripPlaceId: 'ryokan', departureTripPlaceId: 'ryokan' };

  expect(dayStopNumbers({ bases, itemCount: 3 })).toStrictEqual({
    arrival: 1,
    departure: 5,
    itemOffset: 1,
  });
});

test('a day that ends somewhere new counts that base as its last stop', () => {
  const bases = { arrivalTripPlaceId: 'ryokan', departureTripPlaceId: 'hostel' };

  expect(dayStopNumbers({ bases, itemCount: 3 })).toStrictEqual({
    arrival: 1,
    departure: 5,
    itemOffset: 1,
  });
});

test('a day with no base to leave from starts counting at its first item', () => {
  const bases = { arrivalTripPlaceId: null, departureTripPlaceId: null };

  expect(dayStopNumbers({ bases, itemCount: 3 })).toStrictEqual({
    arrival: null,
    departure: null,
    itemOffset: 0,
  });
});

test('a day that only has somewhere to end still numbers its items from one', () => {
  const bases = { arrivalTripPlaceId: null, departureTripPlaceId: 'hostel' };

  expect(dayStopNumbers({ bases, itemCount: 2 })).toStrictEqual({
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

  expect(points.map((entry) => [entry.tripPlaceId, entry.order])).toStrictEqual([
    ['shrine', 2],
    ['market', 3],
  ]);
});

test('a day that moves on gets a marker at each end, numbered first and last', () => {
  const points = basePointsFor({
    day: { dailyBaseDepartureTripPlaceId: 'hostel', dailyBaseTripPlaceId: 'ryokan' },
    itemCount: 2,
    tripPlaces: ['ryokan', 'hostel'],
  });

  expect(points.map((entry) => [entry.baseRole, entry.tripPlaceId, entry.order])).toStrictEqual([
    ['arrival', 'ryokan', 1],
    ['departure', 'hostel', 4],
  ]);
});

test('a base that is already a stop on the day needs no second marker', () => {
  const points = basePointsFor({
    day: { dailyBaseTripPlaceId: 'ryokan' },
    scheduled: ['ryokan'],
    tripPlaces: ['ryokan'],
  });

  expect(points).toStrictEqual([]);
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

  expect(points.map((entry) => [entry.baseRole, entry.tripPlaceId])).toStrictEqual([
    ['both', 'ryokan'],
  ]);
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

  expect(points).toStrictEqual([]);
});

test('a Place off this day says which days already have it', () => {
  const points = buildItineraryMapPoints({
    itinerary: { tripPlaces: [tripPlace('shrine'), tripPlace('market')], unscheduledItems: [] },
    placeUse: {
      market: { dayDates: ['2026-09-06'], dayNumbers: [2], itemCount: 1, unscheduledCount: 0 },
      shrine: {
        dayDates: ['2026-09-05', '2026-09-07'],
        dayNumbers: [1, 3],
        itemCount: 2,
        unscheduledCount: 0,
      },
    },
    resolveItemName: (entry) => entry.id,
    resolvePlaceName: (place) => place.id,
    selectedDay: { items: [] },
    selectedDayNumber: 2,
  });

  expect(points.map((entry) => [entry.tripPlaceId, entry.otherDayNumbers])).toStrictEqual([
    ['shrine', [1, 3]],
    // Its own day is where you already are, so it goes unsaid.
    ['market', undefined],
  ]);
});

test('a scheduled stop keeps its number and carries no cross-day note', () => {
  const points = buildItineraryMapPoints({
    itinerary: { tripPlaces: [tripPlace('shrine')], unscheduledItems: [] },
    placeUse: {
      shrine: {
        dayDates: ['2026-09-05', '2026-09-06'],
        dayNumbers: [1, 2],
        itemCount: 2,
        unscheduledCount: 0,
      },
    },
    resolveItemName: (entry) => entry.id,
    resolvePlaceName: (place) => place.id,
    selectedDay: { items: [item('visit', 'shrine')] },
    selectedDayNumber: 2,
  });

  expect(points.map((entry) => [entry.kind, entry.order, entry.otherDayNumbers])).toStrictEqual([
    ['scheduled', 1, undefined],
  ]);
});

function unlocatedTripPlace(id: string): ItineraryTripPlace {
  const located = tripPlace(id);
  return { ...located, place: { ...located.place, location: null } };
}

function tripMap(input: {
  days: ItineraryDay[];
  focusDayId?: string | null;
  routeSegmentsByDayId?: Record<string, ItineraryRouteSegment[]>;
  tripPlaces: ItineraryTripPlace[];
}) {
  return buildTripMapPoints({
    days: input.days,
    focusDayId: input.focusDayId ?? null,
    resolveItemName: (entry) => entry.customLabel ?? entry.tripPlace?.id ?? '',
    resolvePlaceLocation: (place) => place.place.location,
    resolvePlaceName: (place) => place.id,
    routeSegmentsByDayId: input.routeSegmentsByDayId,
    tripPlaces: input.tripPlaces,
  });
}

function described(points: ItineraryMapPoint[]) {
  return points.map(({ dayIndex, dayNumbers, id, kind, order }) => ({
    dayIndex,
    dayNumbers,
    id,
    kind,
    order,
  }));
}

test("every stop on the trip map keeps the number its own day gives it, in its day's colour", () => {
  const result = tripMap({
    days: [
      day({ id: 'd1', items: [item('i1', 'museum'), item('i2', 'market')] }),
      day({ dailyBaseTripPlaceId: 'hotel', id: 'd2', items: [item('i3', 'ghibli')] }),
    ],
    tripPlaces: ['museum', 'market', 'ghibli', 'hotel'].map(tripPlace),
  });

  expect(described(result.points)).toStrictEqual([
    { dayIndex: 0, dayNumbers: [1], id: 'museum', kind: 'scheduled', order: 1 },
    { dayIndex: 0, dayNumbers: [1], id: 'market', kind: 'scheduled', order: 2 },
    // The stay took first place on day 2, so its first stop is its second.
    { dayIndex: 1, dayNumbers: [2], id: 'ghibli', kind: 'scheduled', order: 2 },
    { dayIndex: undefined, dayNumbers: [2], id: 'stay:hotel', kind: 'base', order: null },
  ]);
  expect(result.focusDayId).toBeNull();
});

test('a Place planned on two days is one marker, on the first, that knows both', () => {
  const result = tripMap({
    days: [
      day({ id: 'd1', items: [item('i1', 'shrine')] }),
      day({ id: 'd2', items: [] }),
      day({ id: 'd3', items: [item('i2', 'market'), item('i3', 'shrine')] }),
    ],
    tripPlaces: ['shrine', 'market'].map(tripPlace),
  });

  const shrine = result.points.filter((entry) => entry.tripPlaceId === 'shrine');
  expect(described(shrine)).toStrictEqual([
    { dayIndex: 0, dayNumbers: [1, 3], id: 'shrine', kind: 'scheduled', order: 1 },
  ]);
  expect(shrine[0]?.itemId).toBe('i1');
});

test('a stay is one marker across its nights, and none when it is already a stop', () => {
  const result = tripMap({
    days: [
      day({ dailyBaseTripPlaceId: 'hotel', id: 'd1', items: [item('i1', 'ryokan')] }),
      day({ dailyBaseTripPlaceId: 'hotel', id: 'd2', items: [] }),
      day({ dailyBaseTripPlaceId: 'ryokan', id: 'd3', items: [] }),
    ],
    tripPlaces: ['hotel', 'ryokan'].map(tripPlace),
  });

  expect(described(result.points)).toStrictEqual([
    { dayIndex: 0, dayNumbers: [1, 3], id: 'ryokan', kind: 'scheduled', order: 2 },
    { dayIndex: undefined, dayNumbers: [1, 2], id: 'stay:hotel', kind: 'base', order: null },
  ]);
});

test("a booked stay comes from legs already in hand, or else from the day's accommodation", () => {
  const result = tripMap({
    days: [
      day({ id: 'd1', items: [item('i1', 'museum')] }),
      day({
        defaultTimeZoneSource: 'accommodation',
        defaultTimeZoneSourceTripPlaceId: 'inn',
        id: 'd2',
        items: [item('i2', 'market')],
      }),
    ],
    routeSegmentsByDayId: {
      d1: [
        baseSegment({
          destination: { id: 'i1', kind: 'itinerary_item', label: null },
          origin: { id: 'inn', kind: 'daily_base', label: null },
        }),
      ],
    },
    tripPlaces: ['museum', 'market', 'inn'].map(tripPlace),
  });

  expect(described(result.points)).toStrictEqual([
    // Day 1's legs start it at the inn, exactly as the Day view numbers it.
    { dayIndex: 0, dayNumbers: [1], id: 'museum', kind: 'scheduled', order: 2 },
    // Day 2's legs are not in hand: the inn is drawn, but takes no number.
    { dayIndex: 1, dayNumbers: [2], id: 'market', kind: 'scheduled', order: 1 },
    { dayIndex: undefined, dayNumbers: [1, 2], id: 'stay:inn', kind: 'base', order: null },
  ]);
});

test('unplanned Places show across the trip, and never on a focused day', () => {
  const input = {
    days: [day({ id: 'd1', items: [item('i1', 'museum')] })],
    tripPlaces: ['museum', 'someday'].map(tripPlace),
  };

  expect(tripMap(input).points.map((entry) => [entry.id, entry.kind])).toStrictEqual([
    ['museum', 'scheduled'],
    ['someday', 'considered'],
  ]);
  expect(tripMap({ ...input, focusDayId: 'd1' }).points.map((entry) => entry.id)).toStrictEqual([
    'museum',
  ]);
});

test('a focused day is numbered exactly as its own map numbers it', () => {
  const focusedDay = day({
    dailyBaseTripPlaceId: 'hotel',
    id: 'd2',
    items: [item('i1', 'museum'), item('i2', 'market')],
  });
  const tripPlaces = ['museum', 'market', 'hotel'].map(tripPlace);
  const result = tripMap({
    days: [day({ id: 'd1', items: [item('i0', 'market')] }), focusedDay],
    focusDayId: 'd2',
    tripPlaces,
  });

  const bases = resolveDailyBases({ day: focusedDay });
  const numbers = dayStopNumbers({ bases, itemCount: 2 });
  const ownMap = [
    ...buildItineraryMapPoints({
      itinerary: { tripPlaces: [], unscheduledItems: [] },
      orderOffset: numbers.itemOffset,
      resolveItemName: (entry) => entry.tripPlace?.id ?? '',
      resolvePlaceName: (place) => place.id,
      selectedDay: focusedDay,
    }),
    ...dailyBasePoints({
      bases,
      numbers,
      resolvePlaceLocation: (place) => place.place.location,
      resolvePlaceName: (place) => place.id,
      scheduledTripPlaceIds: new Set(['museum', 'market']),
      tripPlaces,
    }),
  ];

  expect(result.focusDayId).toBe('d2');
  expect(result.points.map((entry) => [entry.id, entry.order])).toStrictEqual(
    ownMap.map((entry) => [entry.id, entry.order]),
  );
  // The card can still say the market is on day 1 as well.
  expect(result.points.find((entry) => entry.id === 'market')?.dayNumbers).toStrictEqual([1, 2]);
});

test('a day with nothing located cannot be focused, so the map is never asked to show nothing', () => {
  const result = tripMap({
    days: [
      day({ id: 'd1', items: [item('i1', 'museum')] }),
      day({ id: 'd2', items: [item('Free afternoon', null)] }),
    ],
    focusDayId: 'd2',
    tripPlaces: [tripPlace('museum')],
  });

  expect([...result.locatedDayIds]).toStrictEqual(['d1']);
  expect(result.focusDayId).toBeNull();
  expect(result.points.map((entry) => entry.id)).toStrictEqual(['museum']);
});

test('only a stop that names a location it cannot draw is counted as missing one', () => {
  const typedLocation = {
    ...item('Dinner with Sarah', null),
    customLocation: { label: 'Her place', timeZone: null },
  };
  const unlocatedPlace = { ...item('i2', null), tripPlace: unlocatedTripPlace('corner-cafe') };
  const days = [
    day({
      id: 'd1',
      items: [item('Free afternoon', null), typedLocation, unlocatedPlace, item('i3', 'museum')],
    }),
    day({ id: 'd2', items: [{ ...unlocatedPlace, id: 'i4' }] }),
  ];
  const tripPlaces = [tripPlace('museum'), unlocatedTripPlace('corner-cafe')];

  const whole = tripMap({ days, tripPlaces });
  expect(whole.unlocatedStopCount).toBe(3);
  // A Custom Place with no coordinates is never placed on a guess.
  expect(whole.points.map((entry) => entry.id)).toStrictEqual(['museum']);
  expect(tripMap({ days, focusDayId: 'd1', tripPlaces }).unlocatedStopCount).toBe(2);
});
