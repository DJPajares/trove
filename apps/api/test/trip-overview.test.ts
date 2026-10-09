import { beforeEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';

const db = vi.hoisted(() => ({
  trip: { findFirst: vi.fn() },
  itineraryItem: { findMany: vi.fn() },
  task: { count: vi.fn(), findMany: vi.fn() },
  memory: { findFirst: vi.fn() },
}));
vi.mock('@trove/db', async (original) => ({
  ...(await original<typeof import('@trove/db')>()),
  getPrismaClient: () => db,
}));
const signed = vi.hoisted(() => vi.fn());
vi.mock('../src/services/supabase-auth.js', () => ({
  createAuthenticatedSupabaseClient: () => ({
    storage: { from: () => ({ createSignedUrls: signed }) },
  }),
}));

import { getTripOverview } from '../src/services/trip-overview.js';
import { getTripOverviewController } from '../src/controllers/trips.js';
import { TripNotFoundError } from '../src/services/trips.js';
import * as placeData from '../src/services/place-data.js';
import * as routes from '../src/services/itinerary-routes.js';

const date = (value: string) => new Date(`${value}T00:00:00Z`);
const now = new Date('2026-10-09T02:00:00Z');
function trip(start = '2026-10-09', end = '2026-10-10', counts = [2, 0]) {
  return {
    startDate: date(start),
    endDate: date(end),
    referenceTimeZone: 'Asia/Singapore',
    tripInfoEntries: [],
    destinations: [],
    itineraryDays: counts.map((count, index) => ({
      id: `day-${index + 1}`,
      name: index ? 'A slower day' : 'City walks',
      date: new Date(date(start).getTime() + index * 86_400_000),
      _count: { items: count },
    })),
  };
}
function item(id: string, time: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    customLabel: id,
    customLocation: null,
    tripPlace: null,
    createdAt: now,
    updatedAt: now,
    dayPart: null,
    durationMinutes: 120,
    localStartTime: new Date(`1970-01-01T${time}:00Z`),
    startInstant: new Date(`2026-10-09T${time}:00Z`),
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Tokyo',
    travelStatus: 'UPCOMING',
    ...overrides,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.trip.findFirst.mockResolvedValue(trip());
  db.itineraryItem.findMany.mockResolvedValue([]);
  db.task.count.mockResolvedValue(0);
  db.task.findMany.mockResolvedValue([]);
  db.memory.findFirst.mockResolvedValue(null);
  signed.mockResolvedValue({ data: [], error: null });
});

test('ownership is checked before any child reads or private media access', async () => {
  db.trip.findFirst.mockResolvedValue(null);
  await expect(
    getTripOverview('other-owner', 'token', 'trip', 'Asia/Singapore', now),
  ).rejects.toBeInstanceOf(TripNotFoundError);
  expect(db.trip.findFirst.mock.calls[0]?.[0].where).toEqual({
    id: 'trip',
    ownerId: 'other-owner',
  });
  expect(db.itineraryItem.findMany).not.toHaveBeenCalled();
  expect(db.task.count).not.toHaveBeenCalled();
  expect(db.memory.findFirst).not.toHaveBeenCalled();
});

test('planning opens the first unplanned day and reads only that day on a long cold trip', async () => {
  const hydrate = vi.spyOn(placeData, 'hydratePlaceSnapshots');
  const route = vi.spyOn(routes, 'getItineraryDayRoutes');
  db.trip.findFirst.mockResolvedValue(
    trip('2026-11-01', '2026-12-30', [2, 0, ...Array<number>(58).fill(8)]),
  );
  const result = await getTripOverview('owner', 'token', 'trip', 'Asia/Singapore', now);
  expect(result.day).toMatchObject({
    id: 'day-2',
    number: 2,
    name: 'A slower day',
    state: 'empty',
  });
  expect(db.itineraryItem.findMany).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ where: { tripId: 'trip', itineraryDayId: 'day-2' } }),
  );
  expect(hydrate).not.toHaveBeenCalled();
  expect(route).not.toHaveBeenCalled();
  hydrate.mockRestore();
  route.mockRestore();
});

test('active timing follows the traveller clock, skips finished items and refreshes at the next boundary', async () => {
  db.itineraryItem.findMany.mockResolvedValue([
    item('done', '08:00', { travelStatus: 'COMPLETED' }),
    item('museum', '09:00'),
    item('lunch', '12:00'),
  ]);
  const result = await getTripOverview('owner', 'token', 'trip', 'Asia/Singapore', now);
  expect(result.day?.current).toMatchObject({
    id: 'museum',
    kind: 'current',
    startInstant: '2026-10-09T01:00:00.000Z',
  });
  expect(result.day?.next?.id).toBe('lunch');
  expect(result.refreshAt).toBe('2026-10-09T03:00:00.000Z');
  expect(db.task.count.mock.calls[0]?.[0].where).toMatchObject({
    completedAt: null,
    OR: [
      { itineraryDayId: 'day-1' },
      { itineraryItemId: { in: ['museum', 'lunch'] } },
      { dueDate: { lte: date('2026-10-09') } },
    ],
  });
});

test('empty days, finished schedules and traveller dates without a day stay distinct', async () => {
  let result = await getTripOverview('owner', 'token', 'trip', 'Asia/Singapore', now);
  expect(result.day?.state).toBe('finished');
  result = await getTripOverview(
    'owner',
    'token',
    'trip',
    'Asia/Singapore',
    new Date('2026-10-10T02:00:00Z'),
  );
  expect(result.day?.state).toBe('empty');
  result = await getTripOverview('owner', 'token', 'trip', 'America/Los_Angeles', now);
  expect(result.lifecycle).toBe('active');
  expect(result.day).toBeNull();
});

test('completed trips read a bounded personal preview and note, without planning reads', async () => {
  db.trip.findFirst
    .mockResolvedValueOnce(trip('2026-09-01', '2026-09-02'))
    .mockResolvedValueOnce({ storyCoverPhoto: null, memories: [] });
  db.memory.findFirst.mockResolvedValue({ note: 'The unplanned afternoon was the best part.' });
  const result = await getTripOverview('owner', 'token', 'trip', 'Asia/Singapore', now);
  expect(result.memories).toEqual({
    photos: [],
    note: 'The unplanned afternoon was the best part.',
  });
  expect(result.day).toBeNull();
  expect(db.itineraryItem.findMany).not.toHaveBeenCalled();
  expect(db.task.count).not.toHaveBeenCalled();
  expect(db.trip.findFirst.mock.calls[1]?.[0]).toMatchObject({
    where: { ownerId: 'owner' },
    select: { memories: { take: 4, select: { photos: { take: 1 } } } },
  });
});

test('the controller rejects malformed ids and invalid clock zones before reading data', async () => {
  const app = Fastify();
  app.get(
    '/trips/:tripId/overview',
    {
      preHandler: async (request) => {
        request.authUserId = 'owner';
      },
    },
    getTripOverviewController,
  );
  for (const url of [
    '/trips/bad/overview?clockTimeZone=UTC',
    '/trips/00000000-0000-7000-8000-000000000001/overview?clockTimeZone=Invalid/Zone',
  ]) {
    const response = await app.inject({ url, headers: { authorization: 'Bearer token' } });
    expect(response.statusCode).toBe(400);
  }
  expect(db.trip.findFirst).not.toHaveBeenCalled();
  await app.close();
});

test('personal previews sign at most three distinct photos and omit failed links', async () => {
  const photo = (id: string) => ({ id, path: `owned/${id}.jpg`, contentType: 'image/jpeg' });
  db.trip.findFirst.mockResolvedValueOnce(trip('2026-09-01', '2026-09-02')).mockResolvedValueOnce({
    storyCoverPhoto: photo('cover'),
    memories: [
      { photos: [photo('cover')] },
      { photos: [photo('second')] },
      { photos: [photo('third')] },
      { photos: [photo('fourth')] },
    ],
  });
  signed.mockResolvedValue({
    data: [
      { signedUrl: 'https://example.test/cover' },
      { error: 'unavailable' },
      { signedUrl: 'https://example.test/third' },
    ],
    error: null,
  });
  const result = await getTripOverview('owner', 'token', 'trip', 'Asia/Singapore', now);
  expect(signed).toHaveBeenCalledExactlyOnceWith(
    ['owned/cover.jpg', 'owned/second.jpg', 'owned/third.jpg'],
    3600,
  );
  expect(result.memories.photos.map((photo) => photo.id)).toEqual(['cover', 'third']);
});

test('a clock change that skips midnight still provides a usable refresh deadline', async () => {
  const result = await getTripOverview(
    'owner',
    'token',
    'trip',
    'America/Santiago',
    new Date('2026-09-05T18:00:00Z'),
  );
  expect(Date.parse(result.refreshAt)).toBeGreaterThan(Date.parse(result.generatedAt));
});
