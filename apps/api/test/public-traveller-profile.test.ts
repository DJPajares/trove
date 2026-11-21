import type { SupabaseClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import { beforeEach, expect, test } from 'vitest';

import { registerPublicTripRoutes } from '../src/routes/public-trips.js';
import {
  PublicTravellerNotFoundError,
  readPublicTravellerProfile,
} from '../src/services/public-traveller-profile.js';

/**
 * Every traveller's profile is open to anyone, so what matters is what it lets
 * out: their profile and their Public trips with those trips' Memories, and
 * nothing of a Private trip - not its name, its count, or its photos.
 */

const TRAVELLER_ID = '44444444-4444-4444-8444-444444444444';
const QUIET_TRAVELLER_ID = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-21T00:00:00.000Z');

type Photo = { contentType: string; id: string; path: string };
type TripRow = {
  archivedAt: Date | null;
  budgetAmount: number;
  countries: string[];
  destinations: { place: Record<string, unknown>; placeId: string }[];
  endDate: Date;
  experienceNote: string | null;
  experienceRating: number | null;
  id: string;
  memories: { photos: Photo[] }[];
  name: string;
  ownerId: string;
  startDate: Date;
  storyCoverPhoto: Photo | null;
  visibility: 'PRIVATE' | 'PUBLIC';
};

const photo = (id: string): Photo => ({
  contentType: 'image/jpeg',
  id,
  path: `${TRAVELLER_ID}/memory/${id}.jpg`,
});

function trip(overrides: Partial<TripRow> & Pick<TripRow, 'id' | 'name'>): TripRow {
  return {
    archivedAt: null,
    budgetAmount: 1200,
    countries: ['JP'],
    destinations: [],
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    experienceNote: null,
    experienceRating: null,
    memories: [],
    ownerId: TRAVELLER_ID,
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    storyCoverPhoto: null,
    visibility: 'PUBLIC',
    ...overrides,
  };
}

const PUBLIC_COVER = { ...photo('cover'), memory: { trip: { visibility: 'PUBLIC' } } };

const profiles: Record<string, unknown>[] = [
  {
    avatarPath: `${TRAVELLER_ID}/avatar.jpg`,
    bio: ' Slow traveller ',
    coverMemoryPhoto: PUBLIC_COVER,
    displayName: '  Ana  ',
    homeCountryCode: 'PH',
    id: TRAVELLER_ID,
    // Never selected, so it must never be sent.
    temperatureUnit: 'CELSIUS',
    travelStyles: ['Food first'],
  },
  {
    avatarPath: null,
    bio: null,
    coverMemoryPhoto: null,
    displayName: null,
    homeCountryCode: null,
    id: QUIET_TRAVELLER_ID,
    temperatureUnit: null,
    travelStyles: [],
  },
];

/** Signs whatever it is asked to, and remembers what that was. */
let signed: string[] = [];
const sign = (bucket: string, path: string) => {
  signed.push(`${bucket}:${path}`);
  return `https://storage.test/${bucket}/${path}`;
};
const storage = () =>
  ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: sign(bucket, path) },
          error: null,
        }),
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ error: null, signedUrl: sign(bucket, path) })),
          error: null,
        }),
      }),
    },
  }) as unknown as SupabaseClient;

let trips: TripRow[] = [];

type TripWhere = { archivedAt: null; visibility: 'PUBLIC' };

beforeEach(() => {
  signed = [];
  profiles[0]!.coverMemoryPhoto = PUBLIC_COVER;
  trips = [
    trip({
      destinations: [
        {
          place: {
            customLatitude: 35.01,
            customLongitude: 135.77,
            customName: 'Kyoto',
            id: 'place-kyoto',
            kind: 'CUSTOM',
            providerRefs: [],
          },
          placeId: 'place-kyoto',
        },
      ],
      experienceNote: ' Slow and lovely ',
      experienceRating: 5,
      id: 'trip-kyoto',
      memories: [{ photos: [photo('kyoto-1')] }, { photos: [photo('kyoto-2')] }],
      name: 'Kyoto in spring',
    }),
    trip({
      countries: ['PT'],
      endDate: new Date('2027-02-15T00:00:00.000Z'),
      id: 'trip-lisbon',
      // Still ahead, so none of its photographs are signed.
      memories: [{ photos: [photo('lisbon-plan')] }],
      name: 'Lisbon weekend',
      startDate: new Date('2027-02-13T00:00:00.000Z'),
    }),
    trip({
      id: 'trip-private',
      memories: [{ photos: [photo('honeymoon')] }],
      name: 'Secret honeymoon',
      visibility: 'PRIVATE',
    }),
    trip({ archivedAt: new Date(), id: 'trip-archived', name: 'Put away' }),
    trip({
      id: 'trip-someone-else',
      name: 'Not hers',
      ownerId: QUIET_TRAVELLER_ID,
      visibility: 'PRIVATE',
    }),
  ];

  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    profile: {
      findUnique: async (args: {
        select: Record<string, unknown> & {
          ownedTrips: { select: Record<string, unknown>; where: TripWhere };
        };
        where: { id: string };
      }) => {
        const profile = profiles.find((candidate) => candidate.id === args.where.id);
        if (!profile) return null;
        const { select, where } = args.select.ownedTrips;
        const owned = trips
          // The service's own filter, so loosening it fails these tests.
          .filter(
            (row) =>
              row.ownerId === profile.id &&
              row.visibility === where.visibility &&
              row.archivedAt === where.archivedAt,
          )
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
          .map((row) =>
            Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof TripRow]])),
          );
        // Only what the service selected, as Prisma would.
        const row = Object.fromEntries(
          Object.keys(args.select)
            .filter((key) => key !== 'ownedTrips')
            .map((key) => [key, profile[key]]),
        );
        return { ...row, ownedTrips: owned };
      },
    },
  };
});

test('a profile shows its Public trips, newest first, and nothing of the rest', async () => {
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, { now: NOW, storage });

  expect(profile.traveller).toStrictEqual({
    avatarUrl: `https://storage.test/profile-photos/${TRAVELLER_ID}/avatar.jpg`,
    bio: 'Slow traveller',
    coverPhoto: {
      contentType: 'image/jpeg',
      url: `https://storage.test/memory-photos/${TRAVELLER_ID}/memory/cover.jpg`,
    },
    homeCountryCode: 'PH',
    id: TRAVELLER_ID,
    name: 'Ana',
    travelStyles: ['Food first'],
  });
  expect(profile.trips.map((entry) => entry.id)).toStrictEqual(['trip-lisbon', 'trip-kyoto']);
  expect(profile.trips[1]).toStrictEqual({
    countries: ['JP'],
    destinations: [
      { location: { latitude: 35.01, longitude: 135.77 }, name: 'Kyoto', placeId: 'place-kyoto' },
    ],
    endDate: '2026-05-03',
    experienceNote: 'Slow and lovely',
    experienceRating: 5,
    id: 'trip-kyoto',
    memoryPhotos: [
      {
        contentType: 'image/jpeg',
        id: 'kyoto-1',
        url: `https://storage.test/memory-photos/${TRAVELLER_ID}/memory/kyoto-1.jpg`,
      },
      {
        contentType: 'image/jpeg',
        id: 'kyoto-2',
        url: `https://storage.test/memory-photos/${TRAVELLER_ID}/memory/kyoto-2.jpg`,
      },
    ],
    name: 'Kyoto in spring',
    startDate: '2026-05-01',
  });
  const text = JSON.stringify(profile);
  for (const hidden of ['Secret honeymoon', 'honeymoon', 'Put away', 'budget', 'CELSIUS']) {
    expect(text).not.toContain(hidden);
  }
  // A Private trip's Memories are never so much as signed.
  expect(signed.some((path) => path.includes('honeymoon'))).toBe(false);
});

test('a trip still ahead shows no photographs', async () => {
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, { now: NOW, storage });

  expect(profile.trips[0]?.memoryPhotos).toStrictEqual([]);
  expect(signed.some((path) => path.includes('lisbon-plan'))).toBe(false);
});

test('a profile cover from a Private trip is not shown', async () => {
  profiles[0]!.coverMemoryPhoto = {
    ...photo('private-cover'),
    memory: { trip: { visibility: 'PRIVATE' } },
  };
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, { now: NOW, storage });

  expect(profile.traveller.coverPhoto).toBeNull();
  expect(signed.some((path) => path.includes('private-cover'))).toBe(false);
});

test('a photo that cannot be signed is left out, not sent broken', async () => {
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, {
    now: NOW,
    storage: () => null,
  });

  expect(profile.traveller.avatarUrl).toBeNull();
  expect(profile.traveller.coverPhoto).toBeNull();
  expect(profile.trips.every((entry) => entry.memoryPhotos.length === 0)).toBe(true);
});

test('every traveller has a public view, even with nothing Public yet', async () => {
  await expect(
    readPublicTravellerProfile(QUIET_TRAVELLER_ID, { now: NOW, storage }),
  ).resolves.toStrictEqual({
    traveller: {
      avatarUrl: null,
      bio: null,
      coverPhoto: null,
      homeCountryCode: null,
      id: QUIET_TRAVELLER_ID,
      name: null,
      travelStyles: [],
    },
    trips: [],
  });
});

test('an unknown traveller is not found', async () => {
  await expect(readPublicTravellerProfile(UNKNOWN_ID)).rejects.toBeInstanceOf(
    PublicTravellerNotFoundError,
  );
});

async function publicApp() {
  const app = Fastify();
  registerPublicTripRoutes(app);
  await app.ready();
  return app;
}

test('the public profile answers with no credentials and is never cached', async () => {
  const app = await publicApp();

  const response = await app.inject({ method: 'GET', url: `/public/travellers/${TRAVELLER_ID}` });

  expect(response.statusCode).toBe(200);
  expect(response.json().trips).toHaveLength(2);
  // Making a trip Private must take it off the profile at once.
  expect(response.headers['cache-control']).toBe('no-store');

  await app.close();
});

test('every way of not finding a traveller looks the same', async () => {
  const app = await publicApp();

  const responses = await Promise.all(
    [UNKNOWN_ID, 'not-a-uuid'].map((id) =>
      app.inject({ method: 'GET', url: `/public/travellers/${id}` }),
    ),
  );

  for (const response of responses) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({ code: 'traveller_not_found' });
    expect(response.headers['cache-control']).toBe('no-store');
  }

  await app.close();
});
