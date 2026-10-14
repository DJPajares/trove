import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { registerItineraryRoutes } from '../src/routes/itineraries.js';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  previewItineraryMovement,
  applyItineraryMovement,
} from '../src/services/itinerary-movements.js';
import type { MovementInput } from '@trove/types';
import { readCachedPlaceEvidence } from '../src/services/place-evidence-cache.js';
import { readCachedRoute } from '../src/services/route-evidence-cache.js';
import { floatingLocalTimeToInstant, parseLocalTime } from '../src/services/itinerary-rules.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';
import { getProviderCallCounts, resetProviderCallCounts } from '../src/services/provider-usage.js';
vi.mock('../src/services/route-evidence-cache.js', () => ({
  readCachedRoute: vi.fn(async () => ({ kind: 'miss' })),
}));
vi.mock('../src/services/place-evidence-cache.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/place-evidence-cache.js')>()),
  readCachedPlaceEvidence: vi.fn(async () => null),
}));
vi.mock('../src/services/supabase-auth.js', () => ({
  getAuthenticatedUserId: vi.fn(async () => ({ userId: 'user' })),
}));
installFakePrismaClient();
beforeEach(() => {
  resetStore();
  resetProviderCallCounts();
  vi.mocked(readCachedPlaceEvidence).mockReset().mockResolvedValue(null);
  vi.mocked(readCachedRoute).mockReset().mockResolvedValue({ kind: 'miss', reason: 'stale_leg' });
});
function seed() {
  store.trip.push({
    id: 'trip',
    ownerId: 'user',
    startDate: new Date('2026-09-05'),
    endDate: new Date('2026-09-06'),
    referenceTimeZone: 'Asia/Singapore',
    name: 'Trip',
  });
  for (const [id, date] of [
    ['day', '2026-09-05'],
    ['other', '2026-09-06'],
  ])
    store.itineraryDay.push({
      id,
      tripId: 'trip',
      date: new Date(date!),
      defaultTimeZone: 'Asia/Singapore',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
      dailyBaseTripPlaceId: null,
      dailyBaseDepartureTripPlaceId: null,
      routeStartTravelMode: 'WALK',
      planningContext: { intent: null, availability: { start: '08:00', end: '20:00' } },
    });
  for (const id of ['a', 'b', 'new']) {
    store.place.push({
      id,
      kind: 'CUSTOM',
      customName: id,
      customLatitude: 1.3,
      customLongitude: 103.8,
      providerRefs: [],
    });
    store.tripPlace.push({ id: `tp-${id}`, placeId: id, tripId: 'trip', priority: null });
  }
}
function item(id: string, position: number, time: string | null, flexible = true, dayId = 'day') {
  const day = store.itineraryDay.find((d) => d.id === dayId)!;
  store.itineraryItem.push({
    id,
    tripId: 'trip',
    itineraryDayId: dayId,
    position,
    tripPlaceId: `tp-${id}`,
    customLabel: id,
    customLocation: null,
    customLocationTimeZone: null,
    dayPart: flexible ? 'MORNING' : null,
    durationMinutes: 60,
    durationProvenance: flexible ? 'APP_ESTIMATED' : 'USER_OWNED',
    localEndTime: null,
    localStartTime: time ? parseLocalTime(time) : null,
    startInstant: time
      ? floatingLocalTimeToInstant(
          (day.date as Date).toISOString().slice(0, 10),
          time,
          'Asia/Singapore',
        )
      : null,
    timeSemantics: time ? 'FLOATING_LOCAL' : null,
    timingFlexibility: flexible ? 'FLEXIBLE' : 'FIXED',
    timeProvenance: flexible ? 'APP_ESTIMATED' : 'USER_OWNED',
    timeZone: 'Asia/Singapore',
    timeZoneSource: 'DAY_DEFAULT',
    travelModeToNext: 'WALK',
    travelStatus: 'UPCOMING',
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    plannedCostAmount: null,
    plannedCostCurrencyCode: null,
  });
}
const order = () =>
  store.itineraryItem
    .filter((i) => i.itineraryDayId === 'day')
    .toSorted((a, b) => Number(a.position) - Number(b.position))
    .map((i) => i.id);

const move = (
  itemId: string,
  position: number,
  itineraryDayId: string | null = 'day',
): MovementInput => ({
  operation: { kind: 'move', itemId, position, itineraryDayId },
  overrides: [],
});
async function apply(input: MovementInput) {
  const preview = await previewItineraryMovement('user', 'trip', input);
  expect(preview.status, JSON.stringify(preview.issues)).toBe('ready');
  return applyItineraryMovement('user', 'trip', {
    ...input,
    scheduleRevision: preview.scheduleRevision,
    fingerprint: preview.fingerprint,
  });
}
test('preview leaves every stored row unchanged and accepted timing commits together', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const before = structuredClone(store);
  const input = move('b', 0);
  const preview = await previewItineraryMovement('user', 'trip', input);
  expect(store).toEqual(before);
  expect(preview.changes.some((c) => c.itemId === 'b' && c.before.localTime === '11:00')).toBe(
    true,
  );
  const result = await apply(input);
  expect(order()).toEqual(['b', 'a']);
  expect(result.itinerary.days[0]!.items.map((i) => i.id)).toEqual(['b', 'a']);
  expect(getProviderCallCounts()).toEqual({});
});
test.each([0, 1, 2])('insertion at %i preserves durations', async (position) => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  item('new', 2, '13:00');
  await apply(move('new', position));
  expect(order()[position]).toBe('new');
  expect(store.itineraryItem.every((i) => i.durationMinutes === 60)).toBe(true);
});
test.each(['b', 'new'])(
  'exchanges adjacent or distant stops with %s atomically',
  async (otherItemId) => {
    seed();
    item('a', 0, '09:00');
    item('b', 1, '11:00');
    item('new', 2, '13:00');
    await apply({ operation: { kind: 'swap', itemId: 'a', otherItemId }, overrides: [] });
    expect(order()).toEqual(otherItemId === 'b' ? ['b', 'a', 'new'] : ['new', 'b', 'a']);
  },
);
test('a cross-day exchange discloses date and instant changes with identical clocks', async () => {
  seed();
  item('a', 0, '09:00', true);
  item('b', 0, '09:00', true, 'other');
  const input: MovementInput = {
    operation: { kind: 'swap', itemId: 'a', otherItemId: 'b' },
    overrides: [],
  };
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.changes).toHaveLength(2);
  expect(p.changes[0]!.before.date).not.toBe(p.changes[0]!.after.date);
  await apply(input);
  expect(order()).toEqual(['b']);
});
test('a no-fit move never clears its slot or writes a partial reorder', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '10:30', false);
  item('new', 2, '11:30');
  const before = structuredClone(store);
  const input = move('new', 1);
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.status).not.toBe('ready');
  await expect(
    applyItineraryMovement('user', 'trip', {
      ...input,
      scheduleRevision: p.scheduleRevision,
      fingerprint: p.fingerprint,
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store).toEqual(before);
});
test('explicit manual changes to personal fixed times can resolve a move', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '11:00', false);
  const input = { ...move('b', 0), overrides: [{ itemId: 'b', localTime: '08:00' }] };
  await apply(input);
  expect(store.itineraryItem.find((i) => i.id === 'b')).toMatchObject({
    timingFlexibility: 'FIXED',
    timeProvenance: 'USER_OWNED',
    localStartTime: parseLocalTime('08:00'),
  });
});
test('a reservation cannot be retimed or moved to an incompatible date', async () => {
  seed();
  item('a', 0, '09:00');
  store.reservation.push({
    id: 'r',
    tripId: 'trip',
    itineraryItemId: 'a',
    type: 'ACTIVITY',
    localDate: new Date('2026-09-05'),
    localTime: parseLocalTime('09:00'),
    timeZone: 'Asia/Singapore',
  });
  const p = await previewItineraryMovement('user', 'trip', move('a', 0, 'other'));
  expect(p.issues).toContainEqual(
    expect.objectContaining({ code: 'BOOKING_DATE', blocking: true }),
  );
  await expect(
    previewItineraryMovement('user', 'trip', {
      ...move('a', 0),
      overrides: [{ itemId: 'a', localTime: '10:00' }],
    }),
  ).rejects.toThrow('invalid_itinerary_item');
});
test('stale or duplicate acceptance cannot replay a swap', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const input: MovementInput = {
    operation: { kind: 'swap', itemId: 'a', otherItemId: 'b' },
    overrides: [],
  };
  const p = await previewItineraryMovement('user', 'trip', input);
  const accepted = { ...input, scheduleRevision: p.scheduleRevision, fingerprint: p.fingerprint };
  await applyItineraryMovement('user', 'trip', accepted);
  const saved = structuredClone(store);
  await expect(applyItineraryMovement('user', 'trip', accepted)).rejects.toThrow(
    'itinerary_schedule_conflict',
  );
  expect(store).toEqual(saved);
});
test('changed duration invalidates the accepted proposal', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const input = move('b', 0);
  const p = await previewItineraryMovement('user', 'trip', input);
  store.itineraryItem[0]!.durationMinutes = 90;
  const before = structuredClone(store);
  await expect(
    applyItineraryMovement('user', 'trip', {
      ...input,
      scheduleRevision: p.scheduleRevision,
      fingerprint: p.fingerprint,
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store).toEqual(before);
});
test('loose planning stays untimed and unscheduling preserves the exact slot', async () => {
  seed();
  item('a', 0, null);
  item('b', 1, null);
  await apply(move('b', 0));
  expect(store.itineraryItem.every((i) => !i.localStartTime)).toBe(true);
  resetStore();
  seed();
  item('a', 0, '09:00');
  await apply(move('a', 0, null));
  expect(store.itineraryItem[0]).toMatchObject({
    itineraryDayId: null,
    localStartTime: parseLocalTime('09:00'),
  });
});
test.each(['append', 'swap'] as const)(
  'whole day %s and Better order use one commit',
  async (strategy) => {
    seed();
    item('a', 0, '09:00');
    item('b', 1, '11:00');
    item('new', 0, '13:00', true, 'other');
    await apply({
      operation: { kind: 'day', sourceDayId: 'day', targetDayId: 'other', strategy },
      overrides: [],
    });
    expect(order()).toEqual(strategy === 'swap' ? ['new'] : []);
  },
);
test('Better order applies an entire permutation', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  item('new', 2, '13:00');
  await apply({
    operation: { kind: 'order', itineraryDayId: 'day', itemIds: ['new', 'a', 'b'] },
    overrides: [],
  });
  expect(order()).toEqual(['new', 'a', 'b']);
});
test('a timed overlap cannot hide behind an untimed stop', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, null);
  item('new', 2, '11:00', false);
  const input = { ...move('new', 1), overrides: [{ itemId: 'new', localTime: '09:30' }] };
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.issues.some((i) => i.blocking && i.code === 'FIXED_CONFLICT')).toBe(true);
});
test('an unrelated pre-existing conflict remains visible without blocking the move', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '09:30', false);
  item('new', 0, '11:00', true, 'other');
  const extra = {
    ...store.itineraryItem.find((i) => i.id === 'new')!,
    id: 'extra',
    position: 1,
    localStartTime: parseLocalTime('13:00'),
    startInstant: floatingLocalTimeToInstant('2026-09-06', '13:00', 'Asia/Singapore'),
  };
  store.itineraryItem.push(extra);
  await apply(move('extra', 0, 'other'));
  expect(store.itineraryItem.find((i) => i.id === 'a')!.localStartTime).toEqual(
    parseLocalTime('09:00'),
  );
});
test('manual input may acknowledge unknown travel but cannot shorten a visit', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '12:00');
  store.place.find((p) => p.id === 'b')!.customLatitude = null;
  const p = await previewItineraryMovement('user', 'trip', {
    ...move('b', 0),
    overrides: [{ itemId: 'b', localTime: '08:00' }],
  });
  expect(p.status, JSON.stringify(p.issues)).toBe('ready');
  expect(p.limitations).toContain('TRAVEL_UNKNOWN');
  await expect(
    previewItineraryMovement('user', 'trip', {
      ...move('b', 0),
      overrides: [{ itemId: 'b', localTime: '08:00', durationMinutes: 30 }],
    }),
  ).rejects.toThrow('invalid_itinerary_item');
});
test('explicit end times move together and the preview includes the original end', async () => {
  seed();
  item('a', 0, '11:00', false);
  item('b', 1, '12:00');
  store.itineraryItem[1]!.durationMinutes = null;
  store.itineraryItem[1]!.localEndTime = parseLocalTime('13:30');
  const p = await previewItineraryMovement('user', 'trip', move('b', 0));
  const change = p.changes.find((c) => c.itemId === 'b')!;
  expect(change.before.localEndTime).toBe('13:30');
  expect(change.after.durationMinutes).toBe(90);
  await apply(move('b', 0));
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localEndTime).not.toEqual(
    parseLocalTime('13:30'),
  );
});
test('a failed write rolls back parked positions and timing together', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const input = move('b', 0),
    p = await previewItineraryMovement('user', 'trip', input);
  const { getPrismaClient } = await import('@trove/db');
  const prisma = getPrismaClient();
  const execute = prisma.$transaction.bind(prisma);
  const before = structuredClone(store);
  const spy = vi.spyOn(prisma, '$transaction');
  let writes = 0;
  const wrap = async (
    callback: (tx: import('@trove/db').Prisma.TransactionClient) => Promise<unknown>,
  ) =>
    execute(async (tx) => {
      const update = tx.itineraryItem.update.bind(tx.itineraryItem);
      vi.spyOn(tx.itineraryItem, 'update').mockImplementation((args) => {
        if (++writes === 3) throw new Error('write_failed');
        return update(args);
      });
      return callback(tx);
    });
  spy.mockImplementation(wrap as typeof prisma.$transaction);
  try {
    await expect(
      applyItineraryMovement('user', 'trip', {
        ...input,
        scheduleRevision: p.scheduleRevision,
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow('write_failed');
  } finally {
    spy.mockRestore();
  }
  expect(writes).toBe(3);
  expect(store).toEqual(before);
});

test('a no-op preserves every stored field including versions', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const before = structuredClone(store);
  const p = await previewItineraryMovement('user', 'trip', move('a', 0));
  expect(p.changes).toEqual([]);
  await apply(move('a', 0));
  expect(store).toEqual(before);
});
test.each(['COMPLETED', 'SKIPPED', 'AUTHORITATIVE_INSTANT'])(
  '%s timing cannot be manually overridden or shifted by a move',
  async (protection) => {
    seed();
    item('a', 0, '09:00');
    item('b', 1, '11:00');
    const row = store.itineraryItem[0]!;
    if (protection === 'AUTHORITATIVE_INSTANT') row.timeSemantics = protection;
    else row.travelStatus = protection;
    const before = structuredClone(row);
    await expect(
      previewItineraryMovement('user', 'trip', {
        ...move('a', 1),
        overrides: [{ itemId: 'a', localTime: '12:00' }],
      }),
    ).rejects.toThrow('invalid_itinerary_item');
    await apply(move('b', 0));
    expect(store.itineraryItem.find((i) => i.id === 'a')).toMatchObject({
      localStartTime: before.localStartTime,
      startInstant: before.startInstant,
      durationMinutes: before.durationMinutes,
    });
  },
);
test('changed route evidence requires fresh acceptance even if order is unchanged', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const input = move('b', 0);
  const p = await previewItineraryMovement('user', 'trip', input);
  vi.mocked(readCachedRoute).mockResolvedValue({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: new Date().toISOString(), source: 'cache' },
      estimate: { distanceMeters: 1000, durationSeconds: 1800, encodedPolyline: null },
    },
  });
  const before = structuredClone(store);
  await expect(
    applyItineraryMovement('user', 'trip', {
      ...input,
      scheduleRevision: p.scheduleRevision,
      fingerprint: p.fingerprint,
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store).toEqual(before);
});
test('same-day unrelated conflict remains visible and does not block a distant move', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '09:30', false);
  item('new', 2, '12:00', false);
  item('c', 3, '14:00');
  item('d', 4, '16:00');
  for (const i of store.itineraryItem) i.tripPlaceId = 'tp-a';
  const input = move('d', 3);
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.issues.some((i) => i.code === 'FIXED_CONFLICT' && !i.blocking)).toBe(true);
  await apply(input);
});
test('manual input cannot cross split opening hours', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '15:00');
  store.place.find((p) => p.id === 'b')!.providerRefs = [
    { provider: 'GOOGLE', externalPlaceId: 'museum' },
  ];
  vi.mocked(readCachedPlaceEvidence).mockResolvedValue({
    status: 'ok',
    provider: 'google',
    freshness: { fetchedAt: '2026-10-12T00:00:00Z', source: 'cache' },
    place: {
      attributions: [],
      category: 'things_to_do',
      externalPlaceId: 'museum',
      formattedAddress: null,
      googleMapsUri: null,
      location: { latitude: 1.3, longitude: 103.8 },
      name: 'Museum',
      openingPeriods: [
        { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 12, minute: 0 } },
        { open: { day: 6, hour: 14, minute: 0 }, close: { day: 6, hour: 18, minute: 0 } },
      ],
      primaryType: 'museum',
      provider: 'google',
      rating: null,
      rawTypes: ['museum'],
      utcOffsetMinutes: 480,
    },
  });
  const input = { ...move('b', 0), overrides: [{ itemId: 'b', localTime: '12:30' }] };
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.issues).toContainEqual(
    expect.objectContaining({ code: 'OPENING_HOURS', blocking: true }),
  );
  expect(getProviderCallCounts()).toEqual({});
});
test('removing a stop validates the newly connected source-day travel', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '10:10', false);
  item('new', 2, '11:20', false);
  store.place.find((p) => p.id === 'a')!.customLatitude = 1.3;
  store.place.find((p) => p.id === 'b')!.customLatitude = 1.31;
  store.place.find((p) => p.id === 'new')!.customLatitude = 1.32;
  vi.mocked(readCachedRoute).mockImplementation(async (request) => ({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: '2026-10-12T00:00:00Z', source: 'cache' },
      estimate: {
        distanceMeters: 1000,
        durationSeconds:
          request.origin.latitude === 1.3 && request.destination.latitude === 1.32 ? 7200 : 300,
        encodedPolyline: null,
      },
    },
  }));
  const p = await previewItineraryMovement('user', 'trip', move('b', 0, 'other'));
  expect(p.status).not.toBe('ready');
  expect(p.issues.some((i) => i.itemId === 'new' && i.blocking)).toBe(true);
});
test('a return journey must fit before the availability end', async () => {
  seed();
  item('a', 0, '17:00', false);
  item('b', 0, '11:00', false, 'other');
  store.itineraryDay[0]!.dailyBaseTripPlaceId = 'tp-new';
  vi.mocked(readCachedRoute).mockResolvedValue({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: '2026-10-12T00:00:00Z', source: 'cache' },
      estimate: { distanceMeters: 1000, durationSeconds: 3600, encodedPolyline: null },
    },
  });
  const p = await previewItineraryMovement('user', 'trip', {
    ...move('b', 1),
    overrides: [{ itemId: 'b', localTime: '19:00' }],
  });
  expect(p.issues.some((i) => i.itemId === 'b' && i.blocking)).toBe(true);
});

test('authenticated movement routes enforce ownership, proposal acceptance, and legacy gates', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const ids = new Map(
    ['trip', 'day', 'other', 'a', 'b', 'new', 'tp-a', 'tp-b', 'tp-new'].map((id) => [
      id,
      randomUUID(),
    ]),
  );
  for (const rows of [
    store.trip,
    store.itineraryDay,
    store.itineraryItem,
    store.tripPlace,
    store.place,
  ])
    for (const row of rows)
      for (const [key, value] of Object.entries(row))
        if (
          ['id', 'tripId', 'itineraryDayId', 'tripPlaceId', 'placeId'].includes(key) &&
          typeof value === 'string'
        )
          row[key] = ids.get(value) ?? value;
  const app = Fastify();
  registerItineraryRoutes(app);
  const prefix = `/trips/${ids.get('trip')}/itinerary`;
  const headers = { authorization: 'Bearer fixture' };
  const operation = {
    kind: 'move',
    itemId: ids.get('b'),
    itineraryDayId: ids.get('day'),
    position: 0,
  };
  const before = structuredClone(store);
  try {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix + '/movements/preview',
          payload: { operation },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix + '/movements/preview',
          headers,
          payload: { operation: { ...operation, position: -1 } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/trips/${randomUUID()}/itinerary/movements/preview`,
          headers,
          payload: { operation },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix + '/movements/apply',
          headers,
          payload: { operation },
        })
      ).statusCode,
    ).toBe(400);
    for (const timingPolicy of ['preserve', 'reconcile_flexible']) {
      const response = await app.inject({
        method: 'PATCH',
        url: prefix + `/items/${ids.get('b')}/organization`,
        headers,
        payload: { itineraryDayId: ids.get('day'), position: 0, timingPolicy },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('itinerary_movement_review_required');
    }
    const base = { dailyBaseTripPlaceId: null, dailyBaseDepartureTripPlaceId: null };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix + `/days/${ids.get('day')}/move`,
          headers,
          payload: {
            strategy: 'append',
            targetItineraryDayId: ids.get('other'),
            expectedSourceBase: base,
            expectedTargetBase: base,
            expectedSourceItemIds: [ids.get('a'), ids.get('b')],
            expectedTargetItemIds: [],
          },
        })
      ).statusCode,
    ).toBe(409);
    const preview = await app.inject({
      method: 'POST',
      url: prefix + '/movements/preview',
      headers,
      payload: { operation },
    });
    expect(preview.statusCode).toBe(200);
    expect(store).toEqual(before);
    const p = preview.json();
    const accepted = {
      operation,
      scheduleRevision: p.scheduleRevision,
      fingerprint: p.fingerprint,
    };
    const response = await app.inject({
      method: 'POST',
      url: prefix + '/movements/apply',
      headers,
      payload: accepted,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().itinerary.days[0].items[0].id).toBe(ids.get('b'));
    expect(
      (
        await app.inject({
          method: 'POST',
          url: prefix + '/movements/apply',
          headers,
          payload: accepted,
        })
      ).statusCode,
    ).toBe(409);
    expect(getProviderCallCounts()).toEqual({});
  } finally {
    await app.close();
  }
});

test('a no-op does not repair unrelated timing or change zone provenance', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '09:30');
  const before = structuredClone(store);
  const p = await previewItineraryMovement('user', 'trip', move('a', 0));
  expect(p.changes).toEqual([]);
  await apply(move('a', 0));
  expect(store).toEqual(before);
});

test('cross-zone movement discloses and commits the new instant and timezone', async () => {
  seed();
  item('a', 0, '09:00', false);
  store.itineraryItem[0]!.tripPlaceId = null;
  store.itineraryDay[1]!.dailyBaseTripPlaceId = 'tp-b';
  store.place.find((p) => p.id === 'b')!.customTimeZone = 'Asia/Tokyo';
  const input = move('a', 0, 'other');
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.changes[0]).toMatchObject({
    before: { localTime: '09:00', timeZone: 'Asia/Singapore' },
    after: { localTime: '09:00', timeZone: 'Asia/Tokyo', startInstant: '2026-09-06T00:00:00.000Z' },
    reasons: ['day', 'zone'],
  });
  expect(p.status).toBe('needs_input');
  await apply({ ...input, overrides: [{ itemId: 'a', localTime: '09:00' }] });
  expect(store.itineraryItem[0]!.timeZone).toBe('Asia/Tokyo');
});
test('an exact stop without a duration requests manual duration before acceptance', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '11:00', false);
  store.itineraryItem[1]!.tripPlaceId = null;
  store.itineraryItem[1]!.durationMinutes = null;
  const input = move('b', 0);
  const p = await previewItineraryMovement('user', 'trip', input);
  expect(p.status).toBe('needs_input');
  expect(p.editable).toContainEqual(
    expect.objectContaining({ itemId: 'b', durationMinutes: null }),
  );
  await apply({ ...input, overrides: [{ itemId: 'b', localTime: '08:00', durationMinutes: 45 }] });
  expect(store.itineraryItem.find((i) => i.id === 'b')).toMatchObject({
    durationMinutes: 45,
    durationProvenance: 'USER_OWNED',
  });
});
test('a serialization failure is a refresh conflict and cannot persist a partial move', async () => {
  seed();
  item('a', 0, '09:00');
  item('b', 1, '11:00');
  const input = move('b', 0),
    p = await previewItineraryMovement('user', 'trip', input);
  const { getPrismaClient } = await import('@trove/db');
  const spy = vi.spyOn(getPrismaClient(), '$transaction').mockRejectedValueOnce({ code: 'P2034' });
  const before = structuredClone(store);
  try {
    await expect(
      applyItineraryMovement('user', 'trip', {
        ...input,
        scheduleRevision: p.scheduleRevision,
        fingerprint: p.fingerprint,
      }),
    ).rejects.toThrow('itinerary_schedule_conflict');
  } finally {
    spy.mockRestore();
  }
  expect(store).toEqual(before);
});

test('an unknown loose duration cannot hide an impossible known return journey', async () => {
  seed();
  item('a', 0, '17:00', false);
  item('b', 0, null, true, 'other');
  store.itineraryItem[1]!.durationMinutes = null;
  store.itineraryDay[0]!.dailyBaseTripPlaceId = 'tp-new';
  vi.mocked(readCachedRoute).mockResolvedValue({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: '2026-10-12T00:00:00Z', source: 'cache' },
      estimate: { distanceMeters: 1000, durationSeconds: 5400, encodedPolyline: null },
    },
  });
  const p = await previewItineraryMovement('user', 'trip', move('b', 1));
  expect(p.issues.some((i) => i.blocking && i.code === 'FIXED_CONFLICT')).toBe(true);
});
