import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, test } from 'vitest';

import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();

const { deleteTrip } = await import('../src/services/trips.js');
const { processTripMediaCleanup } = await import('../src/services/trip-media-cleanup.js');
const { listPublicItinerary, PublicTripNotFoundError } =
  await import('../src/services/public-itinerary.js');

const OWNER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const TRIP = '00000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-09-26T12:00:00.000Z');

beforeEach(() => {
  resetStore();
  delete process.env.SUPABASE_SECRET_KEY;
});

function seedTrip() {
  store.trip.push({
    id: TRIP,
    ownerId: OWNER,
    coverPhotoPath: `${OWNER}/${TRIP}/cover.jpg`,
    visibility: 'PUBLIC',
    name: 'Disposable shared trip',
    description: null,
    countries: ['SG'],
    startDate: NOW,
    endDate: NOW,
  });
  store.memory.push({ id: 'memory-1', tripId: TRIP });
  store.memoryPhoto.push({
    id: 'photo-1',
    memoryId: 'memory-1',
    path: `${OWNER}/${TRIP}/memory.jpg`,
  });
  store.reservation.push({ id: 'reservation-1', tripId: TRIP });
  store.reservationAttachment.push({
    id: 'attachment-1',
    reservationId: 'reservation-1',
    path: `${OWNER}/${TRIP}/document.pdf`,
  });
  store.place.push({ id: 'globally-saved-place' });
}

function storageClient(
  options: {
    info?: (bucket: string, path: string) => Promise<unknown>;
    remove?: (bucket: string, paths: string[]) => Promise<unknown>;
  } = {},
) {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push({ bucket, paths });
          return (
            options.remove?.(bucket, paths) ?? {
              data: paths.map((name) => ({ name })),
              error: null,
            }
          );
        },
        info: async (path: string) =>
          options.info?.(bucket, path) ?? { data: null, error: { statusCode: '404' } },
      }),
    },
  } as unknown as SupabaseClient;
  return { calls, client };
}

function queue(count: number, bucket = 'memory-photos') {
  for (let index = 0; index < count; index++) {
    store.tripMediaCleanup.push({
      id: `cleanup-${index}`,
      ownerId: OWNER,
      tripId: TRIP,
      bucket,
      path: `${OWNER}/${TRIP}/file-${index}.jpg`,
      attemptCount: 0,
      nextAttemptAt: new Date(NOW.getTime() - 1_000),
      leaseUntil: null,
      leaseToken: null,
      createdAt: new Date(NOW.getTime() - 60_000),
    });
  }
}

test('owner deletion records exact persisted paths, revokes trip data, and is repeatable', async () => {
  seedTrip();
  expect((await listPublicItinerary(TRIP)).trip.name).toBe('Disposable shared trip');
  await deleteTrip(OTHER, '', TRIP);
  expect(store.trip).toHaveLength(1);
  expect(store.tripMediaCleanup).toHaveLength(0);

  await deleteTrip(OWNER, '', TRIP);
  expect(store.trip).toHaveLength(0);
  expect(store.memoryPhoto).toHaveLength(0);
  expect(store.reservationAttachment).toHaveLength(0);
  expect(store.place).toMatchObject([{ id: 'globally-saved-place' }]);
  await expect(listPublicItinerary(TRIP)).rejects.toBeInstanceOf(PublicTripNotFoundError);
  expect(store.tripMediaCleanup.map(({ bucket, path }) => ({ bucket, path }))).toStrictEqual([
    { bucket: 'trip-covers', path: `${OWNER}/${TRIP}/cover.jpg` },
    { bucket: 'memory-photos', path: `${OWNER}/${TRIP}/memory.jpg` },
    { bucket: 'reservation-documents', path: `${OWNER}/${TRIP}/document.pdf` },
  ]);
  await deleteTrip(OWNER, '', TRIP);
  await deleteTrip(OTHER, '', TRIP);
  expect(store.tripMediaCleanup).toHaveLength(3);
});

test('failed and ambiguous Storage responses retain only unconfirmed paths for a later retry', async () => {
  queue(3);
  const failed = storageClient({
    remove: async () => ({ data: null, error: { statusCode: '500' } }),
    info: async () => ({ data: {}, error: null }),
  });
  const first = await processTripMediaCleanup({ client: failed.client, now: NOW });
  expect(first).toMatchObject({
    attempted: 3,
    removed: 0,
    pending: 3,
    oldestPendingAgeSeconds: 60,
  });
  expect(
    store.tripMediaCleanup.every((row) => row.attemptCount === 1 && row.leaseUntil === null),
  ).toBe(true);

  const retryTime = new Date(NOW.getTime() + 6 * 60_000);
  const partial = storageClient({
    remove: async (_bucket, paths) => ({ data: [{ name: paths[0] }], error: null }),
    info: async (_bucket, path) =>
      path.endsWith('file-1.jpg')
        ? { data: null, error: { statusCode: '404' } }
        : { data: {}, error: null },
  });
  const second = await processTripMediaCleanup({ client: partial.client, now: retryTime });
  expect(second).toMatchObject({ attempted: 3, removed: 2, pending: 1 });
  expect(store.tripMediaCleanup[0]?.path).toContain('file-2.jpg');

  const final = await processTripMediaCleanup({
    client: storageClient().client,
    now: new Date(retryTime.getTime() + 11 * 60_000),
  });
  expect(final).toMatchObject({
    attempted: 1,
    removed: 1,
    pending: 0,
    oldestPendingAgeSeconds: null,
  });
});

test('an empty removal response clears a row only after Storage confirms it is absent', async () => {
  queue(1);
  const missing = storageClient({ remove: async () => ({ data: [], error: null }) });
  const report = await processTripMediaCleanup({ client: missing.client, now: NOW });
  expect(report).toMatchObject({ removed: 1, pending: 0 });
});

test('concurrent workers claim each path once and requests stay within 100 per bucket', async () => {
  queue(205);
  const storage = storageClient();
  const reports = await Promise.all([
    processTripMediaCleanup({ client: storage.client, now: NOW }),
    processTripMediaCleanup({ client: storage.client, now: NOW }),
  ]);
  expect(reports.reduce((sum, report) => sum + report.attempted, 0)).toBe(205);
  expect(storage.calls.map((call) => call.paths.length).sort((a, b) => b - a)).toStrictEqual([
    100, 100, 5,
  ]);
  expect(new Set(storage.calls.flatMap((call) => call.paths)).size).toBe(205);
  expect(store.tripMediaCleanup).toHaveLength(0);
});

test('missing privileged credentials leave a committed deletion queued', async () => {
  seedTrip();
  await deleteTrip(OWNER, '', TRIP);
  expect(store.trip).toHaveLength(0);
  expect(store.tripMediaCleanup).toHaveLength(3);
  await expect(processTripMediaCleanup()).rejects.toThrow('storage_cleanup_configuration_missing');
});
