import { expect, test } from 'vitest';

import type { ItineraryDay, ItineraryItem, ItineraryTripPlace } from '@/lib/itinerary/api';
import { resolveOfflineTripModeLeg } from '@/lib/itinerary/trip-mode-leg';

const timeZone = 'Asia/Singapore';

function tripPlace(
  id: string,
  location: { latitude: number; longitude: number } | null,
): ItineraryTripPlace {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'custom',
      location: location ? { ...location, timeZone: null } : null,
      name: `${id} name`,
      note: null,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
      snapshot: null,
      timeZone: null,
    },
    priority: null,
  };
}

function item(id: string, overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: null,
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
    timeZone,
    timeZoneSource: 'day_default',
    travelModeToNext: 'drive',
    travelStatus: 'upcoming',
    // Distinct per stop: two stops at one spot are a standstill, tested on its own.
    tripPlace: tripPlace(`tp-${id}`, { latitude: id.charCodeAt(0), longitude: id.charCodeAt(0) }),
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  } satisfies ItineraryItem;
}

function day(items: ItineraryItem[], overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: '2026-09-05',
    defaultTimeZone: timeZone,
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: 'day',
    items,
    name: null,
    notes: null,
    routeStartTravelMode: 'drive',
    ...overrides,
  } satisfies ItineraryDay;
}

test('before the first stop the leg starts at the daily base', () => {
  const base = tripPlace('base', { latitude: 10, longitude: 10 });
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a'), item('b')], {
      dailyBaseTripPlaceId: 'base',
      routeStartTravelMode: 'walk',
    }),
    nextItemId: 'a',
    tripPlaces: [base],
  });

  expect(leg?.origin).toMatchObject({ id: 'base', kind: 'daily_base' });
  expect(leg?.destination).toMatchObject({ id: 'a', kind: 'itinerary_item' });
  expect(leg?.mode).toBe('walk');
});

test('mid-day the leg runs between the two stops, in the previous stop’s mode', () => {
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a', { travelModeToNext: 'transit' }), item('b')]),
    nextItemId: 'b',
    tripPlaces: [],
  });

  expect(leg?.origin).toMatchObject({ id: 'a', kind: 'itinerary_item' });
  expect(leg?.destination).toMatchObject({ id: 'b', kind: 'itinerary_item' });
  expect(leg?.mode).toBe('transit');
});

test('with nothing left to reach, the leg runs back to the departure base', () => {
  const departure = tripPlace('departure', { latitude: 20, longitude: 20 });
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a'), item('b', { travelModeToNext: 'walk' })], {
      dailyBaseDepartureTripPlaceId: 'departure',
    }),
    nextItemId: null,
    tripPlaces: [departure],
  });

  expect(leg?.origin).toMatchObject({ id: 'b', kind: 'itinerary_item' });
  expect(leg?.destination).toMatchObject({ id: 'departure', kind: 'daily_base' });
  expect(leg?.mode).toBe('walk');
});

test('the day it ends at falls back to the day it began at', () => {
  const base = tripPlace('base', { latitude: 10, longitude: 10 });
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a')], { dailyBaseTripPlaceId: 'base' }),
    nextItemId: null,
    tripPlaces: [base],
  });

  expect(leg?.destination).toMatchObject({ id: 'base', kind: 'daily_base' });
});

test('a first stop with no base to leave from has no leg', () => {
  expect(
    resolveOfflineTripModeLeg({ day: day([item('a')]), nextItemId: 'a', tripPlaces: [] }),
  ).toBeNull();
});

test('a base the device cannot resolve has no leg', () => {
  expect(
    resolveOfflineTripModeLeg({
      day: day([item('a')], { dailyBaseTripPlaceId: 'missing' }),
      nextItemId: 'a',
      tripPlaces: [],
    }),
  ).toBeNull();
});

test('no day at all has no leg', () => {
  expect(resolveOfflineTripModeLeg({ day: null, nextItemId: 'a', tripPlaces: [] })).toBeNull();
});

test('an unlocated base still names itself, so the leg draws with one end open', () => {
  const base = tripPlace('base', null);
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a')], { dailyBaseTripPlaceId: 'base' }),
    nextItemId: 'a',
    tripPlaces: [base],
  });

  expect(leg?.origin.coordinate).toBeNull();
  expect(leg?.origin.name).toBe('base name');
});

test('a stop with only a label keeps its name and admits it has no location', () => {
  const base = tripPlace('base', { latitude: 10, longitude: 10 });
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a', { customLabel: 'Lunch', tripPlace: null })], {
      dailyBaseTripPlaceId: 'base',
    }),
    nextItemId: 'a',
    tripPlaces: [base],
  });

  expect(leg?.destination).toMatchObject({ coordinate: null, name: 'Lunch' });
});

test('a snapshot written before travel modes carries none, and drives', () => {
  const leg = resolveOfflineTripModeLeg({
    day: day([item('a', { travelModeToNext: undefined }), item('b')]),
    nextItemId: 'b',
    tripPlaces: [],
  });

  expect(leg?.mode).toBe('drive');
});

test('sleeping where the day ended is a standstill, not a leg', () => {
  const here = { latitude: 5, longitude: 5 };
  const departure = tripPlace('departure', here);

  expect(
    resolveOfflineTripModeLeg({
      day: day([item('a', { tripPlace: tripPlace('tp-a', here) })], {
        dailyBaseDepartureTripPlaceId: 'departure',
      }),
      nextItemId: null,
      tripPlaces: [departure],
    }),
  ).toBeNull();
});
