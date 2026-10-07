import { expect, test } from 'vitest';

import type { ItineraryTripPlace } from '../lib/itinerary/api.ts';
import type { Memory } from '../lib/memories/api.ts';
import { locatedMemoryPlaces, routeSketch } from '../lib/memories/route-sketch.ts';

const BOX = { height: 120, padding: 10, width: 320 };

function located(id: string, latitude: number, longitude: number): ItineraryTripPlace {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'custom',
      location: { latitude, longitude, timeZone: null },
      name: id,
      note: null,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
      timeZone: null,
    },
    priority: null,
  };
}

function keptAt(id: string, tripPlaceId: string | null): Memory {
  return {
    capturedAt: '2026-09-02T01:30:00.000Z',
    capturedLocalDate: '2026-09-02',
    capturedLocalTime: '10:30',
    createdAt: '2026-09-02T01:30:00.000Z',
    highlightPosition: null,
    id,
    isHighlight: false,
    itineraryDay: null,
    itineraryItem: null,
    note: null,
    photos: [],
    timeZone: 'Asia/Tokyo',
    timeZoneSource: 'trip_reference',
    tripPlace: tripPlaceId
      ? {
          id: tripPlaceId,
          kind: 'custom',
          name: tripPlaceId,
          placeId: `place-${tripPlaceId}`,
          providerRefs: [],
        }
      : null,
    updatedAt: '2026-09-02T01:30:00.000Z',
  };
}

const TOKYO = { latitude: 35.68, longitude: 139.76 };
const HAKONE = { latitude: 35.23, longitude: 139.1 };
const KYOTO = { latitude: 35.01, longitude: 135.77 };

test('places are joined to their coordinates in the order kept, and staying put adds nothing', () => {
  const tripPlaces = [located('tokyo', 35.68, 139.76), located('kyoto', 35.01, 135.77)];
  const memories = [
    keptAt('a', 'tokyo'),
    keptAt('b', 'tokyo'),
    keptAt('c', null),
    keptAt('d', 'nowhere-known'),
    keptAt('e', 'kyoto'),
  ];

  expect(locatedMemoryPlaces(memories, tripPlaces)).toStrictEqual([TOKYO, KYOTO]);
});

test('fewer than three places, or places a stroll apart, draw nothing', () => {
  expect(routeSketch([TOKYO, KYOTO], BOX)).toBeNull();
  expect(
    routeSketch(
      [
        { latitude: 35.0, longitude: 135.0 },
        { latitude: 35.0004, longitude: 135.0003 },
        { latitude: 35.0007, longitude: 135.0001 },
      ],
      BOX,
    ),
  ).toBeNull();
});

test('a route fits inside its box, north up, the same way every time', () => {
  const sketch = routeSketch([TOKYO, HAKONE, KYOTO], BOX);

  expect(sketch).not.toBeNull();
  expect(routeSketch([TOKYO, HAKONE, KYOTO], BOX)).toStrictEqual(sketch);
  for (const point of sketch?.points ?? []) {
    expect(point.x).toBeGreaterThanOrEqual(BOX.padding);
    expect(point.x).toBeLessThanOrEqual(BOX.width - BOX.padding);
    expect(point.y).toBeGreaterThanOrEqual(BOX.padding);
    expect(point.y).toBeLessThanOrEqual(BOX.height - BOX.padding);
  }
  // Tokyo is east of Kyoto, and the most northerly of the three.
  const [tokyo, , kyoto] = sketch?.points ?? [];
  expect((tokyo?.x ?? 0) > (kyoto?.x ?? 0)).toBe(true);
  expect(tokyo?.y).toBe(Math.min(...(sketch?.points ?? []).map((point) => point.y)));
  expect(sketch?.path.startsWith(`M${tokyo?.x} ${tokyo?.y}`)).toBe(true);
});

test('a route across the antimeridian is drawn as the short hop it was', () => {
  const sketch = routeSketch(
    [
      { latitude: -17.7, longitude: 178.4 },
      { latitude: -17.9, longitude: 179.9 },
      { latitude: -18.1, longitude: -179.6 },
    ],
    BOX,
  );
  const xs = (sketch?.points ?? []).map((point) => point.x);

  // Strictly west to east, rather than doubling back around the world.
  expect(xs).toStrictEqual([...xs].sort((left, right) => left - right));
});
