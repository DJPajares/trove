import { beforeEach, expect, test, vi } from 'vitest';
import {
  createItineraryItem,
  organizeItineraryItem,
  updateItineraryItem,
} from '../src/services/itineraries.js';
import {
  applyItineraryDayTiming,
  getItineraryDayTimeSuggestions,
} from '../src/services/itinerary-time-suggestions.js';
import { readCachedRoute } from '../src/services/route-evidence-cache.js';
import { floatingLocalTimeToInstant, parseLocalTime } from '../src/services/itinerary-rules.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';
import { getProviderCallCounts, resetProviderCallCounts } from '../src/services/provider-usage.js';
vi.mock('../src/services/route-evidence-cache.js', () => ({
  readCachedRoute: vi.fn(async () => ({ kind: 'miss' })),
}));
installFakePrismaClient();
beforeEach(() => {
  resetStore();
  resetProviderCallCounts();
  vi.mocked(readCachedRoute).mockClear();
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
      planningContext: { availability: { start: '08:00', end: '20:00' } },
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
test('insertion keeps the chosen position, assigns a complete flexible slot, and retains estimated provenance', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '12:00', false);
  const added = await createItineraryItem('user', 'trip', {
    clientItemId: 'new',
    tripPlaceId: 'tp-new',
    durationMinutes: 60,
    itineraryDayId: 'day',
    position: 1,
    schedule: { kind: 'none' },
    timingPolicy: 'reconcile_flexible',
  });
  expect(order()).toEqual(['a', 'new', 'b']);
  expect(added).toMatchObject({
    localStartTime: '10:00',
    durationMinutes: 60,
    timingFlexibility: 'flexible',
    timeProvenance: 'app_estimated',
  });
  expect(added.scheduling?.changes[0]?.after).toEqual({
    localTime: '10:00',
    localEndTime: '11:00',
  });
  expect(getProviderCallCounts()).toEqual({});
});
test('a moved flexible item loses an infeasible stale slot while neighbors and duration survive', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '10:30', false);
  item('new', 2, '11:30');
  const outcome = await organizeItineraryItem('user', 'trip', 'new', {
    itineraryDayId: 'day',
    position: 1,
    timingPolicy: 'reconcile_flexible',
  });
  expect(order()).toEqual(['a', 'new', 'b']);
  expect(store.itineraryItem.find((i) => i.id === 'new')).toMatchObject({
    localStartTime: null,
    durationMinutes: 60,
    dayPart: 'MORNING',
  });
  expect(store.itineraryItem.find((i) => i.id === 'b')?.localStartTime).toEqual(
    parseLocalTime('10:30'),
  );
  expect(outcome?.scheduling.issues).toContainEqual(
    expect.objectContaining({ itemId: 'new', code: 'NO_ROOM' }),
  );
});
test('cross-day moves reassess both days without moving fixed or completed history', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('new', 1, '10:00');
  item('b', 0, '09:00', false, 'other');
  const outcome = await organizeItineraryItem('user', 'trip', 'new', {
    itineraryDayId: 'other',
    position: 1,
    timingPolicy: 'reconcile_flexible',
  });
  expect(store.itineraryItem.find((i) => i.id === 'new')).toMatchObject({
    itineraryDayId: 'other',
    localStartTime: parseLocalTime('10:00'),
  });
  expect(outcome?.scheduling.issues).toEqual([]);
  expect(getProviderCallCounts()).toEqual({});
  store.itineraryItem.find((i) => i.id === 'new')!.travelStatus = 'COMPLETED';
  await organizeItineraryItem('user', 'trip', 'new', {
    itineraryDayId: 'other',
    position: 0,
    timingPolicy: 'reconcile_flexible',
  });
  expect(store.itineraryItem.find((i) => i.id === 'new')!.localStartTime).toEqual(
    parseLocalTime('10:00'),
  );
});
test('stale atomic previews reject without writes, and partial selection applies together without sorting', async () => {
  seed();
  item('a', 0, null);
  item('b', 1, null);
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(preview.suggestions.every((s) => s.status === 'ok' && s.localEndTime)).toBe(true);
  store.itineraryItem.find((i) => i.id === 'b')!.durationMinutes = 90;
  await expect(
    applyItineraryDayTiming('user', 'trip', 'day', {
      scheduleRevision: preview.scheduleRevision!,
      itemIds: ['a', 'b'],
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store.itineraryItem.every((i) => !i.localStartTime)).toBe(true);
  const fresh = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  await applyItineraryDayTiming('user', 'trip', 'day', {
    scheduleRevision: fresh.scheduleRevision!,
    itemIds: ['b'],
  });
  expect(order()).toEqual(['a', 'b']);
  expect(store.itineraryItem.find((i) => i.id === 'a')!.localStartTime).toBe(null);
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
    parseLocalTime(fresh.suggestions[1]!.localTime!),
  );
});
test('untouched suggested times and durations remain estimates, and actual edits become owned', async () => {
  seed();
  item('a', 0, '09:00');
  await updateItineraryItem('user', 'trip', 'a', {
    schedule: { kind: 'exact', localTime: '09:00', dayPart: 'morning' },
    durationMinutes: 60,
    notes: 'note',
  });
  expect(store.itineraryItem[0]).toMatchObject({
    timeProvenance: 'APP_ESTIMATED',
    durationProvenance: 'APP_ESTIMATED',
  });
  await updateItineraryItem('user', 'trip', 'a', {
    schedule: { kind: 'exact', localTime: '09:15' },
    durationMinutes: 90,
  });
  expect(store.itineraryItem[0]).toMatchObject({
    timeProvenance: 'USER_OWNED',
    durationProvenance: 'USER_OWNED',
    timingFlexibility: 'FIXED',
  });
});
test('structural creation rolls back if reconciliation fails', async () => {
  seed();
  item('a', 0, '09:00', false);
  vi.mocked(readCachedRoute).mockRejectedValueOnce(new Error('cache_read_failed'));
  const before = structuredClone(store.itineraryItem);
  await expect(
    createItineraryItem('user', 'trip', {
      clientItemId: 'new',
      tripPlaceId: 'tp-new',
      durationMinutes: 60,
      itineraryDayId: 'day',
      position: 0,
      schedule: { kind: 'none' },
      timingPolicy: 'reconcile_flexible',
    }),
  ).rejects.toThrow();
  expect(store.itineraryItem).toEqual(before);
});

test('cached route lookup rebuilds both insertion legs and includes the stay on each end', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '13:00', false);
  store.place.find((p) => p.id === 'a')!.customLatitude = 1.31;
  store.place.find((p) => p.id === 'b')!.customLatitude = 1.32;
  store.itineraryDay[0]!.dailyBaseTripPlaceId = 'tp-b';
  await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    candidate: { tripPlaceId: 'tp-new', durationMinutes: 60, position: 1 },
  });
  const legs = vi
    .mocked(readCachedRoute)
    .mock.calls.map(([request]) => [request.origin.latitude, request.destination.latitude]);
  expect(legs).toEqual([
    [1.32, 1.31],
    [1.31, 1.3],
    [1.3, 1.32],
    [1.32, 1.32],
    [1.31, 1.32],
  ]);
  // A→B is read solely for the canonical revision, never used to fit the inserted slot.
  expect(getProviderCallCounts()).toEqual({});
});
test('unknown required travel and unknown duration leave inserted stops untimed', async () => {
  seed();
  item('a', 0, '09:00', false);
  store.place.find((p) => p.id === 'new')!.customLatitude = null;
  const added = await createItineraryItem('user', 'trip', {
    clientItemId: 'new',
    tripPlaceId: 'tp-new',
    durationMinutes: 60,
    itineraryDayId: 'day',
    position: 1,
    schedule: { kind: 'none' },
    timingPolicy: 'reconcile_flexible',
  });
  expect(added.localStartTime).toBe(null);
  expect(added.scheduling?.issues).toContainEqual(
    expect.objectContaining({ code: 'TRAVEL_UNKNOWN', severity: 'review' }),
  );
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'other', {
    candidate: { tripPlaceId: null, durationMinutes: null },
  });
  expect(preview.suggestions[0]).toMatchObject({
    status: 'insufficient_evidence',
    localTime: null,
    missing: ['DURATION_UNKNOWN'],
  });
  expect(getProviderCallCounts()).toEqual({});
});
test('a booking moved to another date remains protected and receives a date warning', async () => {
  seed();
  item('a', 0, '09:00');
  store.reservation.push({
    id: 'booking',
    tripId: 'trip',
    itineraryItemId: 'a',
    type: 'ACTIVITY',
    localDate: new Date('2026-09-05'),
    localTime: parseLocalTime('09:00'),
    timeZone: 'Asia/Singapore',
  });
  const result = await organizeItineraryItem('user', 'trip', 'a', {
    itineraryDayId: 'other',
    position: 0,
    timingPolicy: 'reconcile_flexible',
  });
  expect(result?.scheduling.issues).toContainEqual(
    expect.objectContaining({ code: 'BOOKING_DATE', itemId: 'a' }),
  );
  expect(store.reservation[0]!.localDate).toEqual(new Date('2026-09-05'));
  expect(store.itineraryItem[0]!.localStartTime).toEqual(parseLocalTime('09:00'));
  expect(store.itineraryItem[0]!.startInstant).toEqual(
    floatingLocalTimeToInstant('2026-09-05', '09:00', 'Asia/Singapore'),
  );
});

test('expired route evidence invalidates a preview without outbound refresh', async () => {
  seed();
  item('a', 0, null);
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  // Add a stay so its route measurement belongs to the canonical schedule revision.
  store.itineraryDay[0]!.dailyBaseTripPlaceId = 'tp-b';
  const fresh = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(fresh.scheduleRevision).not.toBe(preview.scheduleRevision);
  vi.mocked(readCachedRoute).mockResolvedValueOnce({ kind: 'miss', reason: 'stale_leg' });
  await expect(
    applyItineraryDayTiming('user', 'trip', 'day', {
      scheduleRevision: fresh.scheduleRevision!,
      itemIds: ['a'],
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store.itineraryItem[0]!.localStartTime).toBe(null);
  expect(getProviderCallCounts()).toEqual({});
});

test('a cached measurement takes precedence over a coordinate estimate', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '13:00', false);
  vi.mocked(readCachedRoute).mockResolvedValueOnce({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: '2026-09-01T00:00:00Z', source: 'cache' },
      estimate: { durationSeconds: 1800, distanceMeters: 1000, encodedPolyline: null },
    },
  });
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    candidate: { tripPlaceId: 'tp-new', durationMinutes: 60, position: 1 },
  });
  expect(preview.suggestions[0]).toMatchObject({ localTime: '10:30', localEndTime: '11:30' });
  expect(getProviderCallCounts()).toEqual({});
});

test('derived score cache writes do not make a timing preview stale', async () => {
  seed();
  item('a', 0, null);
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  store.trip[0]!.planScoreComputedAt = new Date();
  store.trip[0]!.planScore = { score: 100 };
  store.trip[0]!.planScoreRevision = 'derived';
  await expect(
    applyItineraryDayTiming('user', 'trip', 'day', {
      scheduleRevision: preview.scheduleRevision!,
      itemIds: ['a'],
    }),
  ).resolves.toBeDefined();
});

test('unsaved duration and end overrides take precedence and a cleared unknown duration requests input', async () => {
  seed();
  item('a', 0, '09:00');
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'a',
    schedule: 'exact',
    localTime: '15:00',
    localEndTime: '17:00',
    durationMinutes: null,
  });
  expect(preview.suggestions[0]).toMatchObject({
    localTime: '15:00',
    localEndTime: '17:00',
    durationMinutes: 120,
    durationProvenance: 'user_owned',
  });
  const cleared = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'a',
    durationMinutes: null,
  });
  expect(cleared.suggestions[0]).toMatchObject({
    status: 'insufficient_evidence',
    missing: ['DURATION_UNKNOWN'],
    localTime: null,
  });
  expect(store.itineraryItem[0]!.durationMinutes).toBe(60);
});
test('complete slots convert the item timezone independently of the day reference', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('new', 1, null);
  store.itineraryDay[0]!.defaultTimeZone = 'UTC';
  store.itineraryItem[0]!.timeZone = 'UTC';
  store.itineraryItem[0]!.startInstant = new Date('2026-09-05T09:00:00Z');
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'new',
    schedule: 'none',
  });
  expect(preview.suggestions[0]).toMatchObject({
    localTime: '18:00',
    localEndTime: '19:00',
    timeZone: 'Asia/Singapore',
    startInstant: '2026-09-05T10:00:00.000Z',
    endInstant: '2026-09-05T11:00:00.000Z',
  });
});
