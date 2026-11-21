import type { SupabaseClient } from '@supabase/supabase-js';
import Fastify from 'fastify';
import { beforeEach, expect, test } from 'vitest';

import { registerPublicTripRoutes } from '../src/routes/public-trips.js';
import {
  PublicTravellerNotFoundError,
  readPublicTravellerProfile,
} from '../src/services/public-traveller-profile.js';

/**
 * A traveller's public view is reachable by anyone, so what matters is what it
 * lets out: Public trips their owner listed, and nothing about the rest.
 */

const TRAVELLER_ID = '44444444-4444-4444-8444-444444444444';
const QUIET_TRAVELLER_ID = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_ID = '66666666-6666-4666-8666-666666666666';

type TripRow = {
  archivedAt: Date | null;
  bio?: string;
  budgetAmount?: number;
  countries: string[];
  description: string | null;
  endDate: Date;
  id: string;
  name: string;
  ownerId: string;
  publicListedAt: Date | null;
  startDate: Date;
  visibility: 'PRIVATE' | 'PUBLIC';
};

function trip(overrides: Partial<TripRow> & Pick<TripRow, 'id' | 'name'>): TripRow {
  return {
    archivedAt: null,
    budgetAmount: 1200,
    countries: ['JP'],
    description: 'Private-ish framing',
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    ownerId: TRAVELLER_ID,
    publicListedAt: new Date('2026-11-21T00:00:00.000Z'),
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    visibility: 'PUBLIC',
    ...overrides,
  };
}

const profiles = [
  {
    avatarPath: `${TRAVELLER_ID}/avatar.jpg`,
    bio: ' Slow traveller ',
    coverMemoryPhoto: { contentType: 'image/jpeg', path: `${TRAVELLER_ID}/memory/cover.jpg` },
    displayName: '  Ana  ',
    homeCountryCode: 'PH',
    id: TRAVELLER_ID,
    // Never selected, so it must never be sent.
    travelStyles: ['Food first'],
  },
  {
    avatarPath: null,
    bio: null,
    coverMemoryPhoto: null,
    displayName: null,
    homeCountryCode: null,
    id: QUIET_TRAVELLER_ID,
    travelStyles: [],
  },
];

/** Signs whatever it is asked to, and remembers what that was. */
let signed: string[] = [];
const storage = () =>
  ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          signed.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}` }, error: null };
        },
      }),
    },
  }) as unknown as SupabaseClient;

let trips: TripRow[] = [];

type TripWhere = {
  archivedAt: null;
  publicListedAt: { not: null };
  visibility: 'PUBLIC';
};

/** Applies the service's own filter, so a loosened filter fails these tests. */
function matches(row: TripRow, where: TripWhere) {
  return (
    row.visibility === where.visibility &&
    row.archivedAt === where.archivedAt &&
    (where.publicListedAt.not === null ? row.publicListedAt !== null : true)
  );
}

beforeEach(() => {
  signed = [];
  trips = [
    trip({ id: 'trip-listed-old', name: 'Kyoto in spring' }),
    trip({
      id: 'trip-listed-new',
      name: 'Lisbon weekend',
      countries: ['PT'],
      endDate: new Date('2027-02-15T00:00:00.000Z'),
      startDate: new Date('2027-02-13T00:00:00.000Z'),
    }),
    trip({
      id: 'trip-private',
      name: 'Secret honeymoon',
      publicListedAt: null,
      visibility: 'PRIVATE',
    }),
    trip({ id: 'trip-public-before-disclosure', name: 'Old shared link', publicListedAt: null }),
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
          ownedTrips: { select: Record<string, true>; where: TripWhere };
        };
        where: { id: string };
      }) => {
        const profile = profiles.find((candidate) => candidate.id === args.where.id);
        if (!profile) return null;
        const { select, where } = args.select.ownedTrips;
        const owned = trips
          .filter((row) => row.ownerId === profile.id && matches(row, where))
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
          .map((row) =>
            Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof TripRow]])),
          );
        // Only what the service selected, as Prisma would.
        const row = Object.fromEntries(
          Object.keys(args.select)
            .filter((key) => key !== 'ownedTrips')
            .map((key) => [key, profile[key as keyof typeof profile]]),
        );
        return { ...row, ownedTrips: owned };
      },
    },
  };
});

test('a profile lists only Public trips its owner listed, newest first', async () => {
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, { storage });

  // Exhaustive on purpose: this is everything a stranger is shown.
  expect(profile).toStrictEqual({
    traveller: {
      avatarUrl: `https://storage.test/profile-photos/${TRAVELLER_ID}/avatar.jpg`,
      bio: 'Slow traveller',
      coverPhoto: {
        contentType: 'image/jpeg',
        url: `https://storage.test/memory-photos/${TRAVELLER_ID}/memory/cover.jpg`,
      },
      homeCountryCode: 'PH',
      id: TRAVELLER_ID,
      name: 'Ana',
    },
    trips: [
      {
        countries: ['PT'],
        endDate: '2027-02-15',
        id: 'trip-listed-new',
        name: 'Lisbon weekend',
        startDate: '2027-02-13',
      },
      {
        countries: ['JP'],
        endDate: '2026-05-03',
        id: 'trip-listed-old',
        name: 'Kyoto in spring',
        startDate: '2026-05-01',
      },
    ],
  });
  const body = JSON.stringify(profile);
  for (const hidden of ['Secret honeymoon', 'Old shared link', 'Put away', 'Food first']) {
    expect(body).not.toContain(hidden);
  }
  // Only this traveller's own two photos are ever signed.
  expect(signed).toStrictEqual([
    `profile-photos:${TRAVELLER_ID}/avatar.jpg`,
    `memory-photos:${TRAVELLER_ID}/memory/cover.jpg`,
  ]);
});

test('a photo that cannot be signed is left out, not sent broken', async () => {
  const profile = await readPublicTravellerProfile(TRAVELLER_ID, { storage: () => null });

  expect(profile.traveller.avatarUrl).toBeNull();
  expect(profile.traveller.coverPhoto).toBeNull();
});

test('a traveller with nothing listed still has a public view', async () => {
  await expect(readPublicTravellerProfile(QUIET_TRAVELLER_ID, { storage })).resolves.toStrictEqual({
    traveller: {
      avatarUrl: null,
      bio: null,
      coverPhoto: null,
      homeCountryCode: null,
      id: QUIET_TRAVELLER_ID,
      name: null,
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
