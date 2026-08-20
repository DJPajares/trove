import { expect, test } from 'vitest';

import {
  serializeCanonicalPlace,
  serializePlaceReference,
} from '../src/services/place-serializer.js';

/**
 * A provider Place used to leave the serializer with no name and no
 * coordinates, which is why every screen went and asked Google for them itself.
 * These tests are about what now travels with the Place instead.
 */

const NOW = new Date('2026-08-18T00:00:00.000Z');

function providerRef(overrides: Record<string, unknown> = {}) {
  return {
    cachedAt: NOW,
    cachedFormattedAddress: '93 Stamford Rd, Singapore 178897',
    cachedGoogleMapsUri: 'https://maps.google.com/?cid=1',
    cachedLanguageCode: 'en',
    cachedLatitude: 1.2966,
    cachedLongitude: 103.8485,
    cachedName: 'National Museum of Singapore',
    cachedPrimaryType: 'museum',
    cachedTypes: ['museum', 'tourist_attraction'],
    cachedUtcOffsetMinutes: 480,
    externalPlaceId: 'ChIJmuseum',
    provider: 'GOOGLE' as const,
    ...overrides,
  };
}

function providerPlace(overrides: Record<string, unknown> = {}) {
  return {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    id: 'place-1',
    kind: 'PROVIDER' as const,
    providerAddress: 'Stamford Rd',
    providerLabel: 'National Museum',
    providerRefs: [providerRef()],
    ...overrides,
  };
}

test('a provider Place carries the coordinates its snapshot resolved', () => {
  const place = serializeCanonicalPlace(providerPlace(), { now: NOW });

  // This is the whole point: a map pin no longer waits on a provider request.
  expect(place.location).toStrictEqual({ latitude: 1.2966, longitude: 103.8485, timeZone: null });
  expect(place.snapshot?.name).toBe('National Museum of Singapore');
  expect(place.snapshot?.address).toBe('93 Stamford Rd, Singapore 178897');
  expect(place.snapshot?.category).toBe('things_to_do');
  expect(place.snapshot?.stale).toBe(false);
});

test('the provider name stays out of the Trove-owned name field', () => {
  const place = serializeCanonicalPlace(providerPlace(), { now: NOW });

  // `name` is what the traveller called it; the provider's own name lives in
  // the snapshot, so the two are never mistaken for each other (PRD 11.4).
  expect(place.name).toBe(null);
  expect(place.snapshot?.name).toBe('National Museum of Singapore');
});

test("a provider Place's time zone stays null rather than being invented", () => {
  const place = serializeCanonicalPlace(providerPlace(), { now: NOW });

  // The snapshot holds a UTC offset, not an IANA zone. The itinerary does
  // DST-correct local-time maths with this field, so a fixed offset would
  // silently shift times twice a year.
  expect(place.location?.timeZone).toBe(null);
  expect(place.snapshot?.utcOffsetMinutes).toBe(480);
});

test('a Place resolved but never fetched is honest about having no snapshot', () => {
  const place = serializeCanonicalPlace(
    providerPlace({
      providerRefs: [
        providerRef({
          cachedAt: null,
          cachedLatitude: null,
          cachedLongitude: null,
          cachedName: null,
        }),
      ],
    }),
    { now: NOW },
  );

  expect(place.snapshot).toBe(null);
  expect(place.location).toBe(null);
  // The label captured at search time is what keeps it recognisable meanwhile.
  expect(place.providerLabel).toBe('National Museum');
});

test('a snapshot past its 30-day life still renders, and says it is stale', () => {
  const place = serializeCanonicalPlace(
    providerPlace({
      providerRefs: [
        providerRef({ cachedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1_000) }),
      ],
    }),
    { now: NOW },
  );

  expect(place.snapshot?.name).toBe('National Museum of Singapore');
  expect(place.snapshot?.stale).toBe(true);
});

test('a Custom Place is unchanged: its own coordinates, its own name, no snapshot', () => {
  const place = serializeCanonicalPlace(
    {
      customLatitude: { toNumber: () => 1.3521 },
      customLongitude: { toNumber: () => 103.8198 },
      customName: 'Quiet lookout',
      customNote: 'Meet by the sheltered bench.',
      customTimeZone: 'Asia/Singapore',
      id: 'place-2',
      kind: 'CUSTOM',
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
    },
    { now: NOW },
  );

  expect(place).toStrictEqual({
    id: 'place-2',
    kind: 'custom',
    location: { latitude: 1.3521, longitude: 103.8198, timeZone: 'Asia/Singapore' },
    name: 'Quiet lookout',
    note: 'Meet by the sheltered bench.',
    providerAddress: null,
    providerLabel: null,
    providerRefs: [],
    snapshot: null,
  });
});

test('a snapshot refreshed during this request wins over the row it was read with', () => {
  const place = serializeCanonicalPlace(
    providerPlace({ providerRefs: [providerRef({ cachedName: 'Stale name' })] }),
    {
      now: NOW,
      snapshots: new Map([['ChIJmuseum', providerRef({ cachedName: 'Refreshed name' })]]),
    },
  );

  expect(place.snapshot?.name).toBe('Refreshed name');
});

test('an expense or Memory keeps its Trip Place identity and gains the snapshot', () => {
  const reference = serializePlaceReference(
    { id: 'trip-place-1', place: providerPlace() },
    { now: NOW },
  );

  // `id` is the Trip Place and `placeId` the Place — the shape the expenses and
  // Memories screens already key on.
  expect(reference.id).toBe('trip-place-1');
  expect(reference.placeId).toBe('place-1');
  expect(reference.kind).toBe('provider');
  expect(reference.name).toBe(null);
  expect(reference.snapshot?.name).toBe('National Museum of Singapore');
});
