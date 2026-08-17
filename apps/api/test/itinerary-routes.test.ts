import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildItineraryRoutePlan,
  inferAccommodationBases,
  type AccommodationTripPlace,
  type RoutePoint,
} from '../src/services/itinerary-routes.js';

function tripPlace(id: string): AccommodationTripPlace {
  return {
    id,
    place: { id: `place-${id}`, providerRefs: [] },
  } as unknown as AccommodationTripPlace;
}

function point(id: string, kind: RoutePoint['kind'] = 'itinerary_item'): RoutePoint {
  return { coordinates: { latitude: 0, longitude: 0 }, id, kind, label: null };
}

function accommodationDay(
  tripPlaceId: string,
  checkInDate: Date | null,
  checkOutDate: Date | null,
) {
  return {
    reservation: { checkInDate, checkOutDate, tripPlace: tripPlace(tripPlaceId) },
  };
}

test('a single applicable accommodation is the base for both ends of the day', () => {
  const { arrival, departure } = inferAccommodationBases(
    [accommodationDay('hotel-a', new Date('2026-09-01'), new Date('2026-09-03'))],
    new Date('2026-09-01'),
  );

  assert.equal(arrival?.id, 'hotel-a');
  assert.equal(departure?.id, 'hotel-a');
});

test('a transition day infers the checkout accommodation as arrival and the checkin one as departure', () => {
  const dayDate = new Date('2026-09-03');
  const { arrival, departure } = inferAccommodationBases(
    [
      accommodationDay('hotel-a', new Date('2026-09-01'), new Date('2026-09-03')),
      accommodationDay('hotel-b', new Date('2026-09-03'), new Date('2026-09-05')),
    ],
    dayDate,
  );

  assert.equal(arrival?.id, 'hotel-a');
  assert.equal(departure?.id, 'hotel-b');
});

test('two accommodations that do not cleanly disambiguate infer no base rather than guessing', () => {
  const dayDate = new Date('2026-09-03');
  const { arrival, departure } = inferAccommodationBases(
    [
      accommodationDay('hotel-a', new Date('2026-09-01'), new Date('2026-09-05')),
      accommodationDay('hotel-b', new Date('2026-09-01'), new Date('2026-09-05')),
    ],
    dayDate,
  );

  assert.equal(arrival, null);
  assert.equal(departure, null);
});

test('more than two applicable accommodations infer no base', () => {
  const dayDate = new Date('2026-09-03');
  const { arrival, departure } = inferAccommodationBases(
    [
      accommodationDay('hotel-a', new Date('2026-09-01'), dayDate),
      accommodationDay('hotel-b', dayDate, new Date('2026-09-05')),
      accommodationDay('hotel-c', dayDate, new Date('2026-09-06')),
    ],
    dayDate,
  );

  assert.equal(arrival, null);
  assert.equal(departure, null);
});

test('no applicable accommodation infers no base', () => {
  const { arrival, departure } = inferAccommodationBases([], new Date('2026-09-03'));

  assert.equal(arrival, null);
  assert.equal(departure, null);
});

test('symmetric base adds a day-start leg and a return-to-base leg around the items', () => {
  const base = point('hotel', 'daily_base');
  const plans = buildItineraryRoutePlan({
    arrivalBase: base,
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: base,
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  assert.equal(plans.length, 2);
  assert.deepEqual(
    [plans[0]?.modeOwner.kind, plans[0]?.origin.id, plans[0]?.destination.id],
    ['day_start', 'hotel', 'museum'],
  );
  assert.deepEqual(
    [plans[1]?.modeOwner.kind, plans[1]?.origin.id, plans[1]?.destination.id],
    ['item_departure', 'museum', 'hotel'],
  );
});

test('an asymmetric base routes the day-start leg from arrival and the return leg to departure', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: point('hotel-a', 'daily_base'),
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: point('hotel-b', 'daily_base'),
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  assert.equal(plans.length, 2);
  assert.equal(plans[0]?.origin.id, 'hotel-a');
  assert.equal(plans[1]?.destination.id, 'hotel-b');
});

test('an arrival base with no departure base adds no return leg', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: point('hotel', 'daily_base'),
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: null,
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.modeOwner.kind, 'day_start');
});

test('no base and no starting location leaves only between-item legs', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: null,
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: null,
    items: [
      { mode: 'walk', point: point('museum') },
      { mode: 'walk', point: point('park') },
    ],
    startingLocation: null,
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.modeOwner.kind, 'item_departure');
});

test('the leg chain follows item order, so reordering a day rewrites which stop each leg comes from', () => {
  const day = (items: string[]) =>
    buildItineraryRoutePlan({
      arrivalBase: point('hotel', 'daily_base'),
      dayId: 'day-1',
      dayStartMode: 'drive',
      departureBase: point('hotel', 'daily_base'),
      items: items.map((id) => ({ mode: 'drive' as const, point: point(id) })),
      startingLocation: null,
    });

  const chain = (plans: ReturnType<typeof day>) =>
    plans.map((plan) => [plan.origin.id, plan.destination.id]);

  assert.deepEqual(chain(day(['hobbiton', 'redwoods', 'blue-spring'])), [
    ['hotel', 'hobbiton'],
    ['hobbiton', 'redwoods'],
    ['redwoods', 'blue-spring'],
    ['blue-spring', 'hotel'],
  ]);

  // The same three stops, one moved: every leg it touches names a new origin.
  assert.deepEqual(chain(day(['hobbiton', 'blue-spring', 'redwoods'])), [
    ['hotel', 'hobbiton'],
    ['hobbiton', 'blue-spring'],
    ['blue-spring', 'redwoods'],
    ['redwoods', 'hotel'],
  ]);
});
