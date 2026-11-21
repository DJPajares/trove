import { beforeEach, expect, test } from 'vitest';

import {
  listSavedTrips,
  saveTrip,
  SavedTripNotFoundError,
  SavedTripOwnTripError,
  unsaveTrip,
} from '../src/services/saved-trips.js';

/**
 * Keeping a trip in Finds reads someone else's trip, so what matters is that it
 * follows the read-only link's rule: only Public trips, never a Private one, and
 * nothing beyond what the link shows.
 */

const READER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

type TripRow = {
  budgetAmount: number;
  countries: string[];
  endDate: Date;
  id: string;
  name: string;
  owner: { displayName: string | null };
  ownerId: string;
  startDate: Date;
  visibility: 'PRIVATE' | 'PUBLIC';
};

let trips: TripRow[] = [];
let saved: { createdAt: Date; ownerId: string; tripId: string }[] = [];

function trip(overrides: Partial<TripRow> & Pick<TripRow, 'id' | 'name'>): TripRow {
  return {
    budgetAmount: 4000,
    countries: ['VN'],
    endDate: new Date('2026-11-23T00:00:00.000Z'),
    owner: { displayName: '  Ana  ' },
    ownerId: OWNER,
    startDate: new Date('2026-11-18T00:00:00.000Z'),
    visibility: 'PUBLIC',
    ...overrides,
  };
}

/** Picks the selected keys, so a field the service does not ask for never appears. */
function pick(
  row: Record<string, unknown>,
  select: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(select).map(([key, value]): [string, unknown] => [
      key,
      value === true
        ? row[key]
        : pick(
            row[key] as Record<string, unknown>,
            (value as { select: Record<string, unknown> }).select,
          ),
    ]),
  );
}

beforeEach(() => {
  trips = [
    trip({ id: 'a1111111-1111-4111-8111-111111111111', name: 'Central Vietnam Days' }),
    trip({
      id: 'b2222222-2222-4222-8222-222222222222',
      name: 'Gone quiet',
      visibility: 'PRIVATE',
    }),
    trip({ id: 'c3333333-3333-4333-8333-333333333333', name: 'My own', ownerId: READER }),
  ];
  saved = [];

  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    profile: { upsert: async () => ({}) },
    savedTrip: {
      deleteMany: async ({ where }: { where: { ownerId: string; tripId: string } }) => {
        saved = saved.filter(
          (row) => !(row.ownerId === where.ownerId && row.tripId === where.tripId),
        );
        return { count: 1 };
      },
      findMany: async ({
        select,
        where,
      }: {
        select: { createdAt: true; trip: { select: Record<string, unknown> } };
        where: { ownerId: string; trip: { visibility: 'PUBLIC' } };
      }) =>
        saved
          .filter((row) => row.ownerId === where.ownerId)
          .map((row) => ({ row, trip: trips.find((candidate) => candidate.id === row.tripId)! }))
          // The service's own filter, so loosening it fails these tests.
          .filter(({ trip: found }) => found.visibility === where.trip.visibility)
          .toSorted((left, right) => right.row.createdAt.getTime() - left.row.createdAt.getTime())
          .map(({ row, trip: found }) => ({
            createdAt: row.createdAt,
            trip: pick(found as unknown as Record<string, unknown>, select.trip.select),
          })),
      upsert: async ({ create }: { create: { ownerId: string; tripId: string } }) => {
        if (!saved.some((row) => row.ownerId === create.ownerId && row.tripId === create.tripId))
          saved.push({ ...create, createdAt: new Date(Date.now() + saved.length) });
        return {};
      },
    },
    trip: {
      findFirst: async ({ where }: { where: { id: string; visibility: 'PUBLIC' } }) => {
        const found = trips.find(
          (candidate) => candidate.id === where.id && candidate.visibility === where.visibility,
        );
        return found ? { id: found.id, ownerId: found.ownerId } : null;
      },
    },
  };
});

test('a kept trip is listed with only what its read-only link shows', async () => {
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');

  expect(await listSavedTrips(READER)).toStrictEqual([
    {
      countries: ['VN'],
      endDate: '2026-11-23',
      id: 'a1111111-1111-4111-8111-111111111111',
      name: 'Central Vietnam Days',
      ownerName: 'Ana',
      savedAt: expect.any(String),
      startDate: '2026-11-18',
    },
  ]);
});

test('keeping a trip twice keeps it once', async () => {
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');

  expect(await listSavedTrips(READER)).toHaveLength(1);
});

test('a Private trip cannot be kept, and answers like a missing one', async () => {
  await expect(saveTrip(READER, 'b2222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(
    SavedTripNotFoundError,
  );
  await expect(saveTrip(READER, 'f0000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(
    SavedTripNotFoundError,
  );
});

test('a traveller cannot keep their own trip', async () => {
  await expect(saveTrip(READER, 'c3333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
    SavedTripOwnTripError,
  );
});

test('a kept trip its owner makes Private drops out of Finds, and returns if made Public again', async () => {
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');
  trips[0]!.visibility = 'PRIVATE';

  expect(await listSavedTrips(READER)).toStrictEqual([]);

  trips[0]!.visibility = 'PUBLIC';
  expect((await listSavedTrips(READER)).map((entry) => entry.name)).toStrictEqual([
    'Central Vietnam Days',
  ]);
});

test('letting go of a kept trip removes it, and of one never kept is no error', async () => {
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');
  await unsaveTrip(READER, 'a1111111-1111-4111-8111-111111111111');
  await unsaveTrip(READER, 'a1111111-1111-4111-8111-111111111111');

  expect(await listSavedTrips(READER)).toStrictEqual([]);
});

test('one traveller never sees what another kept', async () => {
  await saveTrip(READER, 'a1111111-1111-4111-8111-111111111111');

  expect(await listSavedTrips(OWNER)).toStrictEqual([]);
});
