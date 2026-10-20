import Fastify from 'fastify';
import { archiveTripController, listTripsController } from '../src/controllers/trips.js';
import { beforeEach, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({
  trip: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('@trove/db', async (original) => ({
  ...(await original<typeof import('@trove/db')>()),
  getPrismaClient: () => db,
}));
vi.mock('../src/services/supabase-auth.js', () => ({
  createAuthenticatedSupabaseClient: () => null,
}));
import { setTripArchived, tripArchiveIndex, listTrips } from '../src/services/trips.js';

const now = new Date('2026-10-20T00:00:00Z');
const row = {
  id: 'trip',
  ownerId: 'owner',
  archivedAt: null as Date | null,
  name: 'Our trip',
  startDate: new Date('2026-10-19'),
  endDate: new Date('2026-10-23'),
  referenceTimeZone: 'UTC',
  referenceTimeZoneSource: 'EXPLICIT',
  createdAt: now,
  updatedAt: now,
  coverPhotoPath: null,
  destinations: [],
  startingPlace: null,
  itineraryDays: [],
  _count: { memories: 2, dayExperiences: 1 },
  visibility: 'PUBLIC',
  countries: ['JP'],
};
beforeEach(() => {
  vi.clearAllMocks();
  row.archivedAt = null;
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.$queryRaw.mockImplementation(async () => [{ archived_at: row.archivedAt }]);
  db.trip.update.mockImplementation(async ({ data }) => Object.assign(row, data));
  db.trip.findFirst.mockImplementation(async () => row);
  db.trip.findMany.mockResolvedValue([]);
});

test('archive/restore are idempotent, preserve public visibility and content, and keep date-derived lifecycle', async () => {
  const archived = await setTripArchived('owner', 'token', 'trip', true);
  const timestamp = row.archivedAt;
  expect(archived).toMatchObject({
    archivedAt: timestamp!.toISOString(),
    visibility: 'public',
    memoryCount: 2,
    name: 'Our trip',
  });
  await setTripArchived('owner', 'token', 'trip', true);
  expect(db.trip.update).toHaveBeenCalledTimes(1);
  expect(row.archivedAt).toBe(timestamp);
  const restored = await setTripArchived('owner', 'token', 'trip', false);
  expect(restored).toMatchObject({ archivedAt: null, visibility: 'public', memoryCount: 2 });
  expect(restored.lifecycle).toBe(archived.lifecycle);
  expect(db.trip.update).toHaveBeenCalledTimes(2);
});

test('ownership is checked under the archive row lock', async () => {
  db.$queryRaw.mockResolvedValue([]);
  await expect(setTripArchived('someone-else', 'token', 'trip', true)).rejects.toThrow(
    'trip_not_found',
  );
  expect(db.trip.update).not.toHaveBeenCalled();
  expect(db.$queryRaw.mock.calls[0]?.slice(1)).toEqual(['trip', 'someone-else']);
});

test('the normal collection excludes archives while cleanup receives all owned identities', async () => {
  await listTrips('owner', 'token');
  expect(db.trip.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { ownerId: 'owner', archivedAt: null } }),
  );
  await listTrips('owner', 'token', 'only');
  expect(db.trip.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { ownerId: 'owner', archivedAt: { not: null } } }),
  );
  db.trip.findMany.mockResolvedValue([
    { id: 'normal', archivedAt: null },
    { id: 'archived', archivedAt: now },
  ]);
  expect(await tripArchiveIndex('owner')).toEqual({
    ownedTripIds: ['normal', 'archived'],
    archivedTripCount: 1,
  });
  expect(db.trip.findMany).toHaveBeenLastCalledWith({
    where: { ownerId: 'owner' },
    select: { id: true, archivedAt: true },
  });
});

test('archive HTTP contract validates state/filter values and retains normal ownership failures', async () => {
  const app = Fastify();
  app.decorateRequest('authUserId', 'owner');
  app.patch('/trips/:tripId/archive', archiveTripController);
  app.get('/trips', listTripsController);
  const url = '/trips/00000000-0000-4000-8000-000000000001/archive';
  const headers = { authorization: 'Bearer token' };
  for (const payload of [{ archived: 'yes' }, { archived: true, visibility: 'public' }, {}]) {
    expect((await app.inject({ method: 'PATCH', url, headers, payload })).statusCode).toBe(400);
  }
  expect(
    (await app.inject({ method: 'GET', url: '/trips?archived=maybe', headers })).statusCode,
  ).toBe(400);
  db.$queryRaw.mockResolvedValue([]);
  expect(
    (await app.inject({ method: 'PATCH', url, headers, payload: { archived: true } })).statusCode,
  ).toBe(404);
  await app.close();
});
