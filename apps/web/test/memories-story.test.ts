import { expect, test } from 'vitest';

import type { Memory, MemoryTripPlace } from '../lib/memories/api.ts';
import { buildTripStory, placeName, providerPlaceId } from '../lib/memories/story.ts';

const YOYOGI: MemoryTripPlace = {
  id: 'trip-place-yoyogi',
  kind: 'provider',
  name: null,
  placeId: 'place-yoyogi',
  providerRefs: [{ externalPlaceId: 'ChIJyoyogi', provider: 'google' }],
};

const KIYOSUMI: MemoryTripPlace = {
  id: 'trip-place-kiyosumi',
  kind: 'custom',
  name: 'Kiyosumi Garden',
  placeId: 'place-kiyosumi',
  providerRefs: [],
};

function memory(overrides: Partial<Memory> & Pick<Memory, 'id'>): Memory {
  return {
    capturedAt: '2026-09-06T01:30:00.000Z',
    capturedLocalDate: '2026-09-06',
    capturedLocalTime: '10:30',
    createdAt: '2026-09-06T01:30:00.000Z',
    highlightPosition: null,
    isHighlight: false,
    itineraryDay: null,
    itineraryItem: null,
    note: null,
    photos: [],
    timeZone: 'Asia/Tokyo',
    timeZoneSource: 'trip_place',
    tripPlace: null,
    updatedAt: '2026-09-06T01:30:00.000Z',
    ...overrides,
  };
}

function photo(id: string) {
  return {
    contentType: 'image/jpeg',
    createdAt: '2026-09-06T01:30:00.000Z',
    fileName: `${id}.jpg`,
    id,
    position: 0,
    sizeBytes: 1_024,
    url: null,
  };
}

test('a story groups what the traveller captured into days and Places', () => {
  const story = buildTripStory([
    memory({
      capturedLocalDate: '2026-09-07',
      capturedLocalTime: '19:05',
      id: 'lanterns',
      note: 'Lanterns on the canal',
      tripPlace: KIYOSUMI,
    }),
    memory({
      capturedLocalTime: '08:15',
      id: 'dawn',
      note: 'Dawn at the park',
      photos: [photo('dawn-1'), photo('dawn-2')],
      tripPlace: YOYOGI,
    }),
    memory({ capturedLocalTime: '13:40', id: 'lunch', note: 'Standing lunch' }),
    memory({ capturedLocalTime: '17:20', id: 'benches', tripPlace: YOYOGI }),
  ]);

  expect(
    story.days.map((day) => ({
      date: day.date,
      memories: day.memories.map((entry) => entry.id),
      photoCount: day.photoCount,
    })),
  ).toStrictEqual([
    { date: '2026-09-06', memories: ['dawn', 'lunch', 'benches'], photoCount: 2 },
    { date: '2026-09-07', memories: ['lanterns'], photoCount: 0 },
  ]);

  // Places are ordered by how much of the trip happened there.
  expect(
    story.places.map((place) => ({
      memories: place.memories.map((entry) => entry.id),
      tripPlace: place.tripPlace.id,
    })),
  ).toStrictEqual([
    { memories: ['dawn', 'benches'], tripPlace: YOYOGI.id },
    { memories: ['lanterns'], tripPlace: KIYOSUMI.id },
  ]);
  expect({
    memoryCount: story.memoryCount,
    photoCount: story.photoCount,
    unplaced: story.unplacedCount,
  }).toStrictEqual({ memoryCount: 4, photoCount: 2, unplaced: 1 });
});

test('a sparse or empty trip stays a valid story with nothing invented', () => {
  const empty = buildTripStory([]);
  expect(empty).toStrictEqual({
    days: [],
    highlights: [],
    memoryCount: 0,
    photoCount: 0,
    places: [],
    unplacedCount: 0,
  });

  const single = buildTripStory([memory({ id: 'only', note: 'One quiet evening' })]);
  expect(single.days.map((day) => day.date)).toStrictEqual(['2026-09-06']);
  expect(single.places).toStrictEqual([]);
  expect({
    highlights: single.highlights.length,
    photos: single.photoCount,
    unplaced: single.unplacedCount,
  }).toStrictEqual({ highlights: 0, photos: 0, unplaced: 1 });
});

test('Days stays chronological while Highlights keeps its curated order', () => {
  const story = buildTripStory([
    memory({ capturedLocalTime: '08:00', highlightPosition: 2, id: 'first', isHighlight: true }),
    memory({ capturedLocalTime: '12:00', highlightPosition: 0, id: 'second', isHighlight: true }),
    memory({ capturedLocalTime: '18:00', id: 'third', isHighlight: true }),
    memory({ capturedLocalTime: '21:00', highlightPosition: 1, id: 'fourth', isHighlight: true }),
    memory({ capturedLocalTime: '22:00', id: 'ordinary' }),
  ]);

  expect(story.days[0]?.memories.map((entry) => entry.id)).toStrictEqual([
    'first',
    'second',
    'third',
    'fourth',
    'ordinary',
  ]);
  // A freshly highlighted Memory has no position yet and waits at the end.
  expect(story.highlights.map((entry) => entry.id)).toStrictEqual([
    'second',
    'fourth',
    'first',
    'third',
  ]);
});

test('grouping follows the trip-local date stored with the Memory, not the reading device', () => {
  // One instant, two Memories, resolved against the timezones they were captured in.
  const departure = memory({
    capturedAt: '2026-09-05T15:30:00.000Z',
    capturedLocalDate: '2026-09-05',
    capturedLocalTime: '11:30',
    id: 'departure',
    timeZone: 'America/New_York',
    timeZoneSource: 'itinerary_day',
  });
  const arrival = memory({
    capturedAt: '2026-09-05T15:30:00.000Z',
    capturedLocalDate: '2026-09-06',
    capturedLocalTime: '00:30',
    id: 'arrival',
    timeZone: 'Asia/Tokyo',
  });

  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const atHome = buildTripStory([departure, arrival]);
    process.env.TZ = 'Pacific/Auckland';
    const abroad = buildTripStory([departure, arrival]);

    expect(
      atHome.days.map((day) => ({ date: day.date, memories: day.memories.map((e) => e.id) })),
    ).toStrictEqual([
      { date: '2026-09-05', memories: ['departure'] },
      { date: '2026-09-06', memories: ['arrival'] },
    ]);
    expect(abroad.days).toStrictEqual(atHome.days);
  } finally {
    process.env.TZ = original;
  }
});

test('correcting a Memory’s day and Place moves it through every grouping at once', () => {
  const misfiled = memory({
    capturedLocalDate: '2026-09-06',
    id: 'misfiled',
    note: 'Filed against the wrong day',
    tripPlace: YOYOGI,
  });
  const other = memory({ id: 'other', tripPlace: YOYOGI });

  const before = buildTripStory([misfiled, other]);
  expect(before.days.map((day) => day.date)).toStrictEqual(['2026-09-06']);
  expect(before.places[0]?.memories.map((entry) => entry.id)).toStrictEqual(['misfiled', 'other']);

  const corrected = buildTripStory([
    { ...misfiled, capturedLocalDate: '2026-09-07', tripPlace: KIYOSUMI },
    other,
  ]);

  expect(
    corrected.days.map((day) => ({ date: day.date, memories: day.memories.map((e) => e.id) })),
  ).toStrictEqual([
    { date: '2026-09-06', memories: ['other'] },
    { date: '2026-09-07', memories: ['misfiled'] },
  ]);
  expect(
    corrected.places.map((place) => ({
      memories: place.memories.map((entry) => entry.id),
      tripPlace: place.tripPlace.id,
    })),
  ).toStrictEqual([
    { memories: ['other'], tripPlace: YOYOGI.id },
    { memories: ['misfiled'], tripPlace: KIYOSUMI.id },
  ]);
  expect(corrected.memoryCount).toBe(2);
});

test('a Place shows a Trove-owned name before one resolved from the provider', () => {
  expect(placeName(KIYOSUMI, 'Provider name', 'Item label')).toBe('Kiyosumi Garden');
  expect(placeName(YOYOGI, 'Yoyogi Park', 'Morning walk')).toBe('Yoyogi Park');
  expect(placeName(YOYOGI, null, 'Morning walk')).toBe('Morning walk');
  expect(placeName(YOYOGI, null, null)).toBe(null);

  expect(providerPlaceId(YOYOGI)).toBe('ChIJyoyogi');
  expect(providerPlaceId(KIYOSUMI)).toBe(null);
});
