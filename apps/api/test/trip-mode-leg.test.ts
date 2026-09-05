import { expect, test } from 'vitest';

import { resolveTripModeLeg } from '../src/services/trip-mode-context.js';

/**
 * The resolver is pure: it reads records the day query already loaded and
 * reaches nothing. That is the whole point of it living beside `leaveBy`
 * rather than inside it, so these tests take the records directly.
 */
function place(id: string, coordinates: { latitude: number; longitude: number } | null) {
  return {
    customLatitude: coordinates ? coordinates.latitude : null,
    customLongitude: coordinates ? coordinates.longitude : null,
    customName: `${id} name`,
    customNote: null,
    customTimeZone: null,
    id: `place-${id}`,
    kind: 'CUSTOM',
    providerAddress: null,
    providerLabel: null,
    providerRefs: [],
  };
}

function tripPlace(id: string, coordinates: { latitude: number; longitude: number } | null) {
  return { customName: null, id, place: place(id, coordinates) };
}

function item(
  id: string,
  overrides: {
    coordinates?: { latitude: number; longitude: number } | null;
    customLabel?: string | null;
    travelModeToNext?: string;
    withPlace?: boolean;
  } = {},
) {
  const {
    // Distinct per stop by default: two stops at one spot are a standstill now,
    // which is a rule of its own rather than something every case should trip.
    coordinates = { latitude: id.charCodeAt(0), longitude: id.charCodeAt(0) },
    customLabel = null,
    travelModeToNext = 'DRIVE',
    withPlace = true,
  } = overrides;

  return {
    customLabel,
    id,
    travelModeToNext,
    tripPlace: withPlace ? tripPlace(`tp-${id}`, coordinates) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolve = (input: Record<string, unknown>) => resolveTripModeLeg(input as any);

test('before the first stop the leg starts at the daily base', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
    dayStartMode: 'WALK',
    departureBase: null,
    items: [item('a'), item('b')],
    nextItemId: 'a',
  });

  expect(leg?.origin).toMatchObject({ id: 'base', kind: 'daily_base' });
  expect(leg?.destination).toMatchObject({ id: 'a', kind: 'itinerary_item' });
  // The day's own start mode owns the leg out of the base, not the item's.
  expect(leg?.mode).toBe('walk');
  expect(leg?.origin.coordinate).toEqual({ latitude: 10, longitude: 10 });
});

test('mid-day the leg runs between the two stops, in the previous stop’s mode', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
    dayStartMode: 'DRIVE',
    departureBase: null,
    items: [item('a', { travelModeToNext: 'TRANSIT' }), item('b')],
    nextItemId: 'b',
  });

  expect(leg?.origin).toMatchObject({ id: 'a', kind: 'itinerary_item' });
  expect(leg?.destination).toMatchObject({ id: 'b', kind: 'itinerary_item' });
  expect(leg?.mode).toBe('transit');
});

test('with nothing left to reach, the leg runs back to the departure base', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
    dayStartMode: 'DRIVE',
    departureBase: tripPlace('departure', { latitude: 20, longitude: 20 }),
    items: [item('a'), item('b', { travelModeToNext: 'WALK' })],
    nextItemId: null,
  });

  expect(leg?.origin).toMatchObject({ id: 'b', kind: 'itinerary_item' });
  expect(leg?.destination).toMatchObject({ id: 'departure', kind: 'daily_base' });
  expect(leg?.mode).toBe('walk');
});

test('a first stop with no base to leave from has no leg', () => {
  expect(
    resolve({
      arrivalBase: null,
      dayStartMode: 'DRIVE',
      departureBase: null,
      items: [item('a')],
      nextItemId: 'a',
    }),
  ).toBeNull();
});

test('a finished day with no departure base has no leg', () => {
  expect(
    resolve({
      arrivalBase: null,
      dayStartMode: 'DRIVE',
      departureBase: null,
      items: [item('a')],
      nextItemId: null,
    }),
  ).toBeNull();
});

test('an empty day has no leg either way', () => {
  const shared = { arrivalBase: tripPlace('base', null), dayStartMode: 'DRIVE', items: [] };

  expect(resolve({ ...shared, departureBase: null, nextItemId: null })).toBeNull();
  expect(resolve({ ...shared, departureBase: null, nextItemId: 'missing' })).toBeNull();
});

test('an unlocated base still names itself, so the leg draws with one end open', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', null),
    dayStartMode: 'DRIVE',
    departureBase: null,
    items: [item('a')],
    nextItemId: 'a',
  });

  expect(leg?.origin.coordinate).toBeNull();
  expect(leg?.origin.name).toBe('base name');
});

test('a stop with only a label keeps its name and admits it has no location', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
    dayStartMode: 'DRIVE',
    departureBase: null,
    items: [item('a', { customLabel: 'Lunch', withPlace: false })],
    nextItemId: 'a',
  });

  expect(leg?.destination).toMatchObject({ coordinate: null, name: 'Lunch' });
});

test('a stop with neither a place nor a label cannot anchor a leg', () => {
  expect(
    resolve({
      arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
      dayStartMode: 'DRIVE',
      departureBase: null,
      items: [item('a', { withPlace: false })],
      nextItemId: 'a',
    }),
  ).toBeNull();
});

test('an unrecognised travel mode falls back to driving', () => {
  const leg = resolve({
    arrivalBase: null,
    dayStartMode: 'DRIVE',
    departureBase: null,
    items: [item('a', { travelModeToNext: 'SOMETHING_NEW' }), item('b')],
    nextItemId: 'b',
  });

  expect(leg?.mode).toBe('drive');
});

test('sleeping where the day ended is a standstill, not a leg', () => {
  const here = { latitude: 5, longitude: 5 };

  expect(
    resolve({
      arrivalBase: tripPlace('base', { latitude: 10, longitude: 10 }),
      dayStartMode: 'DRIVE',
      departureBase: tripPlace('departure', here),
      items: [item('a', { coordinates: here })],
      nextItemId: null,
    }),
  ).toBeNull();
});

test('two unlocated ends are unknown rather than identical', () => {
  const leg = resolve({
    arrivalBase: tripPlace('base', null),
    dayStartMode: 'DRIVE',
    departureBase: null,
    items: [item('a', { coordinates: null })],
    nextItemId: 'a',
  });

  expect(leg).not.toBeNull();
  expect(leg?.origin.coordinate).toBeNull();
});
