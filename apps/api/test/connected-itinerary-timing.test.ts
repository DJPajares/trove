import { beforeEach, expect, test, vi } from 'vitest';
import {
  createItineraryItem,
  listItinerary,
  organizeItineraryItem,
  updateItineraryItem,
} from '../src/services/itineraries.js';
import {
  applyItineraryDayTiming,
  getItineraryDayTimeSuggestions,
  getItineraryTimingReview,
  applyItineraryTimingReview,
} from '../src/services/itinerary-time-suggestions.js';
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
installFakePrismaClient();
beforeEach(() => {
  resetStore();
  resetProviderCallCounts();
  vi.mocked(readCachedPlaceEvidence).mockReset().mockResolvedValue(null);
  vi.mocked(readCachedRoute).mockReset().mockResolvedValue({ kind: 'miss', reason: 'missing_leg' });
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

test.each(['Pacific/Auckland', 'Asia/Singapore'])(
  'compares the 10:00 shopping stop in %s against a 12:30 Auckland stop',
  async (shoppingZone) => {
    seed();
    store.trip[0]!.referenceTimeZone = 'Pacific/Auckland';
    store.itineraryDay[0]!.defaultTimeZone = 'Pacific/Auckland';
    for (const place of store.place) {
      place.customLatitude = -36.918;
      place.customLongitude = 174.841;
      place.customTimeZone = 'Pacific/Auckland';
    }
    item('a', 0, '10:00', false);
    item('b', 1, '12:30', false);
    for (const [index, zone] of [shoppingZone, 'Pacific/Auckland'].entries()) {
      const stop = store.itineraryItem[index]!;
      stop.timeZone = zone;
      stop.timeZoneSource = 'EXPLICIT';
      stop.startInstant = floatingLocalTimeToInstant(
        '2026-09-05',
        index ? '12:30' : '10:00',
        zone!,
      );
      stop.durationMinutes = index ? 240 : 120;
    }
    const before = structuredClone(store.itineraryItem);
    const result = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
    expect(result.issues).toEqual([]);
    expect(store.itineraryItem).toEqual(before);
    expect(getProviderCallCounts()).toEqual({});
  },
);

test('saving a stop with review policy preserves neighboring times until explicit acceptance', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '10:00');
  const result = await updateItineraryItem('user', 'trip', 'a', {
    durationMinutes: 90,
    timingPolicy: 'review_flexible',
  });
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
    parseLocalTime('10:00'),
  );
  expect(result.scheduling!.changes).toEqual([
    expect.objectContaining({
      itemId: 'b',
      before: { localTime: '10:00', localEndTime: '11:00' },
      after: { localTime: '10:30', localEndTime: '11:30' },
    }),
  ]);
  const before = structuredClone(store.itineraryItem);
  const preview = await getItineraryTimingReview('user', 'trip', 'day');
  expect(store.itineraryItem).toEqual(before);
  const accepted = await applyItineraryTimingReview('user', 'trip', 'day', {
    ...preview.proposals![0]!,
    itemIds: ['b'],
  });
  expect(accepted.applied.map((i) => i.itemId)).toEqual(['b']);
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
    parseLocalTime('10:30'),
  );
  expect(accepted.scheduling.changes).toEqual([]);
  expect(getProviderCallCounts()).toEqual({});
});

test('new stops stay untimed until the traveller applies their preview', async () => {
  seed();
  item('a', 0, '09:00', false);
  const added = await createItineraryItem('user', 'trip', {
    clientItemId: 'new',
    tripPlaceId: 'tp-new',
    durationMinutes: 60,
    itineraryDayId: 'day',
    position: 1,
    schedule: { kind: 'none' },
    timingPolicy: 'review_flexible',
  });
  expect(added.localStartTime).toBe(null);
  // A reconnect/retry must preserve the pending proposal for the same saved stop.
  const retry = await createItineraryItem('user', 'trip', {
    clientItemId: 'new',
    tripPlaceId: 'tp-new',
    durationMinutes: 60,
    itineraryDayId: 'day',
    position: 1,
    schedule: { kind: 'none' },
    timingPolicy: 'review_flexible',
  });
  expect(retry.scheduling!.changes).toEqual(added.scheduling!.changes);
  const proposal = added.scheduling!.proposals![0]!;
  expect(proposal.targetItemId).toBe('new');
  await applyItineraryTimingReview('user', 'trip', 'day', { ...proposal, itemIds: ['new'] });
  expect(store.itineraryItem.find((i) => i.id === 'new')!.localStartTime).toEqual(
    parseLocalTime('10:00'),
  );
});

test('review apply rejects stale, foreign and duplicate rows without writes', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '09:30');
  const preview = await getItineraryTimingReview('user', 'trip', 'day');
  const proposal = preview.proposals![0]!;
  await expect(
    applyItineraryTimingReview('user', 'trip', 'day', {
      ...proposal,
      targetItemId: 'b',
      itemIds: ['b'],
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  for (const itemIds of [['a'], ['missing'], ['b', 'b']]) {
    const before = structuredClone(store.itineraryItem);
    await expect(
      applyItineraryTimingReview('user', 'trip', 'day', { ...proposal, itemIds }),
    ).rejects.toThrow('itinerary_schedule_conflict');
    expect(store.itineraryItem).toEqual(before);
  }
  store.itineraryItem.find((i) => i.id === 'a')!.durationMinutes = 90;
  const before = structuredClone(store.itineraryItem);
  await expect(
    applyItineraryTimingReview('user', 'trip', 'day', { ...proposal, itemIds: ['b'] }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  await expect(getItineraryTimingReview('other-user', 'trip', 'day')).rejects.toThrow(
    'trip_not_found',
  );
  await expect(
    applyItineraryTimingReview('other-user', 'trip', 'day', { ...proposal, itemIds: ['b'] }),
  ).rejects.toThrow('trip_not_found');
  expect(store.itineraryItem).toEqual(before);
});

test('dependent changes require group acceptance and never silently retime an unselected stop', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('new', 1, '09:30');
  item('b', 2, '10:00');
  const preview = await getItineraryTimingReview('user', 'trip', 'day');
  expect(preview.changes.map((c) => c.itemId)).toEqual(['new', 'b']);
  const before = structuredClone(store.itineraryItem);
  await expect(
    applyItineraryTimingReview('user', 'trip', 'day', {
      ...preview.proposals![0]!,
      itemIds: ['new'],
    }),
  ).rejects.toThrow('itinerary_timing_group_required');
  expect(store.itineraryItem).toEqual(before);
  await applyItineraryTimingReview('user', 'trip', 'day', {
    ...preview.proposals![0]!,
    itemIds: ['new', 'b'],
  });
  expect(store.itineraryItem.find((i) => i.id === 'new')!.localStartTime).toEqual(
    parseLocalTime('10:00'),
  );
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
    parseLocalTime('11:00'),
  );
});
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
test('complete slots keep local clocks independently of all timezone metadata', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('new', 1, null);
  store.itineraryDay[0]!.defaultTimeZone = 'UTC';
  store.itineraryItem[0]!.timeZone = 'UTC';
  store.itineraryItem[0]!.timeZoneSource = 'EXPLICIT';
  store.itineraryItem[0]!.startInstant = new Date('2026-09-05T09:00:00Z');
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'new',
    schedule: 'none',
  });
  expect(preview.suggestions[0]).toMatchObject({
    localTime: '10:00',
    localEndTime: '11:00',
  });
});

test('reordering estimated exact stops supersedes stale dayparts and its canonical assessment stays clean', async () => {
  seed();
  store.itineraryDay[0]!.planningContext = { intent: null, availability: null };
  item('a', 0, '14:00');
  item('b', 1, '17:00');
  store.itineraryItem[0]!.dayPart = 'AFTERNOON';
  store.itineraryItem[1]!.dayPart = 'EVENING';
  const result = await organizeItineraryItem('user', 'trip', 'b', {
    itineraryDayId: 'day',
    position: 0,
    timingPolicy: 'reconcile_flexible',
  });
  expect(order()).toEqual(['b', 'a']);
  expect(store.itineraryItem.find((i) => i.id === 'b')).toMatchObject({
    localStartTime: parseLocalTime('08:00'),
    dayPart: 'EVENING',
    durationMinutes: 60,
  });
  expect(store.itineraryItem.find((i) => i.id === 'a')!.localStartTime).toEqual(
    parseLocalTime('14:00'),
  );
  expect(result?.scheduling.issues).toEqual([]);
  expect((await getItineraryDayTimeSuggestions('user', 'trip', 'day')).issues).toEqual([]);
  expect(getProviderCallCounts()).toEqual({});
});

test('a no-fit move preserves neighboring flexible slots and canonical warnings stay on one untimed stop', async () => {
  seed();
  item('a', 0, '09:00', false);
  item('b', 1, '10:00');
  item('new', 2, '11:00');
  store.itineraryItem.find((i) => i.id === 'new')!.durationMinutes = 180;
  store.itineraryDay[0]!.planningContext = {
    intent: null,
    availability: { start: '08:00', end: '12:00' },
  };
  const result = await organizeItineraryItem('user', 'trip', 'new', {
    itineraryDayId: 'day',
    position: 1,
    timingPolicy: 'reconcile_flexible',
  });
  expect(result?.scheduling.issues).toEqual([
    expect.objectContaining({ itemId: 'new', code: 'NO_ROOM' }),
  ]);
  expect(store.itineraryItem.find((i) => i.id === 'new')!.localStartTime).toBe(null);
  expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
    parseLocalTime('10:00'),
  );
  expect((await getItineraryDayTimeSuggestions('user', 'trip', 'day')).issues).toEqual([
    expect.objectContaining({ itemId: 'new', code: 'NO_ROOM' }),
  ]);
  expect(getProviderCallCounts()).toEqual({});
});

function conflictDay(next = '17:00') {
  seed();
  item('a', 0, '10:00', false);
  item('b', 1, '12:00', false);
  item('new', 2, next, false);
  store.itineraryItem[0]!.durationMinutes = 120;
  store.itineraryItem[1]!.durationMinutes = 240;
  vi.mocked(readCachedRoute).mockResolvedValue({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: '2026-09-01T00:00:00Z', source: 'cache' },
      estimate: { durationSeconds: 300, distanceMeters: 300, encodedPolyline: null },
    },
  });
}

test('a conflict and the unchanged timing editor return the same complete usable slot', async () => {
  conflictDay();
  const before = structuredClone(store.itineraryItem);
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  const conflict = assessment.issues!.find((issue) => issue.itemId === 'b')!;
  const editor = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'b',
    schedule: 'exact',
    localTime: '12:00',
    durationMinutes: 240,
  });
  expect(conflict.suggestion).toMatchObject({
    status: 'ok',
    localTime: '12:05',
    localEndTime: '16:05',
    durationMinutes: 240,
    affectedItemIds: [],
  });
  expect(editor.suggestions[0]).toEqual(conflict.suggestion);
  expect(editor.scheduleRevision).toBe(assessment.scheduleRevision);
  expect(store.itineraryItem).toEqual(before);
  const slot = conflict.suggestion!;
  await updateItineraryItem('user', 'trip', 'b', {
    schedule: { kind: 'exact', localTime: slot.localTime! },
    durationMinutes: slot.durationMinutes,
    scheduleRevision: assessment.scheduleRevision,
    timingPolicy: 'review_flexible',
    timingFlexibility: 'fixed',
  });
  expect(store.itineraryItem[1]!.localStartTime).toEqual(parseLocalTime('12:05'));
  expect(store.itineraryItem[2]!.localStartTime).toEqual(before[2]!.localStartTime);
  const after = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(after.issues?.filter((issue) => issue.itemId === 'b')).toEqual([]);
  expect(getProviderCallCounts()).toEqual({});
});

test('an arrival lower bound is not a valid four-hour slot before the next protected stop', async () => {
  conflictDay('16:00');
  store.itineraryItem[2]!.travelStatus = 'COMPLETED';
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  const issue = assessment.issues!.find((issue) => issue.itemId === 'b')!;
  expect(issue.orderConflict).toBeDefined();
  expect(issue.suggestion).toMatchObject({ status: 'no_feasible_time', localTime: null });
  const editor = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'b',
    schedule: 'exact',
    localTime: '12:00',
  });
  expect(editor.suggestions[0]).toEqual(issue.suggestion);
  expect(store.itineraryItem[1]!.durationMinutes).toBe(240);
});

test('saved exact slots do not reacquire a stale morning daypart when suggested independently', async () => {
  seed();
  item('a', 0, '13:00', false);
  item('b', 1, '13:30', true);
  const direct = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' });
  const editor = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'b',
    schedule: 'exact',
    localTime: '13:30',
  });
  expect(direct.suggestions[0]).toMatchObject({ status: 'ok', localTime: '14:00' });
  expect(direct.suggestions[0]).toEqual(editor.suggestions[0]);
});

test('protected timing conflicts never include a directly applicable repair', async () => {
  conflictDay();
  store.itineraryItem[1]!.travelStatus = 'COMPLETED';
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(assessment.issues!.find((issue) => issue.itemId === 'b')?.suggestion).toBeUndefined();
});

test('a direct repair revision expires if the following stop changes', async () => {
  conflictDay();
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  store.itineraryItem[2]!.durationMinutes = 120;
  const before = structuredClone(store.itineraryItem);
  await expect(
    updateItineraryItem('user', 'trip', 'b', {
      schedule: { kind: 'exact', localTime: '12:05' },
      scheduleRevision: assessment.scheduleRevision,
      timingPolicy: 'review_flexible',
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store.itineraryItem).toEqual(before);
});

test('repairs and warnings use the stop local clock even when the day reference zone differs', async () => {
  conflictDay();
  for (const place of store.place) {
    place.customLatitude = -36.848;
    place.customLongitude = 174.763;
    place.customTimeZone = 'Pacific/Auckland';
  }
  for (const stop of store.itineraryItem) {
    stop.timeZone = 'Pacific/Auckland';
    stop.timeZoneSource = 'PLACE';
    const clock = (stop.localStartTime as Date).toISOString().slice(11, 16);
    stop.startInstant = floatingLocalTimeToInstant('2026-09-05', clock, 'Pacific/Auckland');
  }
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  const issue = assessment.issues!.find((issue) => issue.itemId === 'b')!;
  expect(issue.orderConflict?.earliestStartLocal).toBe('2026-09-05T12:05');
  expect(issue.suggestion).toMatchObject({
    status: 'ok',
    localTime: '12:05',
    timeZone: 'Pacific/Auckland',
  });
  const editor = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'b',
    schedule: 'exact',
    localTime: '12:00',
  });
  expect(editor.suggestions[0]).toEqual(issue.suggestion);
});

test('The Shelf four-hour visit and its following personal stop form one reviewable timing proposal', async () => {
  conflictDay('16:00');
  store.itineraryItem[1]!.timingFlexibility = 'FLEXIBLE';
  const before = structuredClone(store.itineraryItem);
  const assessment = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  const editor = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
    itemId: 'b',
    schedule: 'exact',
    localTime: '12:00',
    durationMinutes: 240,
  });
  expect(editor.suggestions[0]).toMatchObject({
    status: 'ok',
    localTime: '12:05',
    localEndTime: '16:05',
    affectedItemIds: ['new'],
  });
  const issue = assessment.issues!.find((i) => i.itemId === 'b')!;
  expect(issue.suggestion).toEqual(editor.suggestions[0]);
  expect(store.itineraryItem).toEqual(before);
});

test.each([true, false])(
  'a dependent repair previews and atomically applies the complete chain (following flexible=%s)',
  async (flexible) => {
    conflictDay('16:00');
    store.itineraryItem[1]!.timingFlexibility = 'FLEXIBLE';
    store.itineraryItem[2]!.timingFlexibility = flexible ? 'FLEXIBLE' : 'FIXED';
    store.itineraryItem[2]!.durationMinutes = 30;
    const before = structuredClone(store.itineraryItem);
    const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' });
    const request = response.suggestions[0]!.review!;
    expect(request).toBeDefined();
    const preview = await getItineraryTimingReview(
      'user',
      'trip',
      'day',
      request.targetItemId!,
      request.repair,
    );
    expect(preview.changes).toEqual([
      {
        itemId: 'b',
        itineraryDayId: 'day',
        before: { localTime: '12:00', localEndTime: '16:00' },
        after: { localTime: '12:05', localEndTime: '16:05' },
      },
      {
        itemId: 'new',
        itineraryDayId: 'day',
        before: { localTime: '16:00', localEndTime: '16:30' },
        after: { localTime: '16:10', localEndTime: '16:40' },
      },
    ]);
    expect(store.itineraryItem).toEqual(before);
    const proposal = preview.proposals![0]!;
    await expect(
      applyItineraryTimingReview('user', 'trip', 'day', { ...proposal, itemIds: ['b'] }),
    ).rejects.toThrow('itinerary_timing_group_required');
    expect(store.itineraryItem).toEqual(before);
    const result = await applyItineraryTimingReview('user', 'trip', 'day', {
      ...proposal,
      itemIds: ['b', 'new'],
    });
    expect(result.applied).toEqual(preview.changes);
    expect(store.itineraryItem[0]).toEqual(before[0]);
    expect(store.itineraryItem[1]).toMatchObject({
      localStartTime: parseLocalTime('12:05'),
      durationMinutes: 240,
      timingFlexibility: 'FLEXIBLE',
    });
    expect(store.itineraryItem[2]).toMatchObject({
      localStartTime: parseLocalTime('16:10'),
      durationMinutes: 30,
      timingFlexibility: flexible ? 'FLEXIBLE' : 'FIXED',
    });
    expect(result.scheduling.changes).toEqual([]);
    const after = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
    expect(after.issues?.filter((issue) => issue.severity === 'conflict')).toEqual([]);
    expect(getProviderCallCounts()).toEqual({});
  },
);

test('a changed dependent repair expires without writing any stop', async () => {
  conflictDay('16:00');
  const repair = { schedule: 'exact' as const, localTime: '12:00', durationMinutes: 240 };
  const preview = await getItineraryTimingReview('user', 'trip', 'day', 'b', repair);
  const proposal = preview.proposals![0]!;
  store.itineraryItem[2]!.durationMinutes = 90;
  const before = structuredClone(store.itineraryItem);
  await expect(
    applyItineraryTimingReview('user', 'trip', 'day', { ...proposal, itemIds: ['b', 'new'] }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  await expect(
    applyItineraryTimingReview('user', 'trip', 'day', {
      ...proposal,
      repair: { ...repair, durationMinutes: 180 },
      itemIds: ['b', 'new'],
    }),
  ).rejects.toThrow('itinerary_schedule_conflict');
  expect(store.itineraryItem).toEqual(before);
});

test('a requested duration is included in the review rather than discarded', async () => {
  conflictDay('16:00');
  const repair = { schedule: 'exact' as const, localTime: '12:00', durationMinutes: 250 };
  const preview = await getItineraryTimingReview('user', 'trip', 'day', 'b', repair);
  expect(preview.changes[0]!.after).toEqual({ localTime: '12:05', localEndTime: '16:15' });
  await applyItineraryTimingReview('user', 'trip', 'day', {
    ...preview.proposals![0]!,
    itemIds: ['b', 'new'],
  });
  expect(store.itineraryItem[1]!.durationMinutes).toBe(250);
  expect(store.itineraryItem[2]!.localStartTime).toEqual(parseLocalTime('16:20'));
});

test.each(['COMPLETED', 'SKIPPED'])(
  'a grouped repair never moves %s history',
  async (travelStatus) => {
    conflictDay('16:00');
    store.itineraryItem[2]!.travelStatus = travelStatus;
    const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' });
    expect(response.suggestions[0]).toMatchObject({ status: 'no_feasible_time', localTime: null });
    expect(response.suggestions[0]!.review).toBeUndefined();
  },
);

test('dependent repairs cannot overrun availability or rewrite a protected journey', async () => {
  conflictDay('16:00');
  store.itineraryDay[0]!.planningContext = {
    intent: null,
    availability: { start: '08:00', end: '16:30' },
  };
  const repair = { schedule: 'exact' as const, localTime: '12:00', durationMinutes: 240 };
  const before = structuredClone(store.itineraryItem);
  const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' });
  expect(response.suggestions[0]!.status).toBe('no_feasible_time');
  expect((await getItineraryTimingReview('user', 'trip', 'day', 'b', repair)).changes).toEqual([]);
  store.itineraryDay[0]!.planningContext = {
    intent: null,
    availability: { start: '08:00', end: '20:00' },
  };
  store.itineraryItem[2]!.timeSemantics = 'AUTHORITATIVE_INSTANT';
  expect(
    (await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' })).suggestions[0]!
      .status,
  ).toBe('no_feasible_time');
  expect(store.itineraryItem.slice(0, 2)).toEqual(before.slice(0, 2));
  expect(getProviderCallCounts()).toEqual({});
});

test('a dependent proposal cannot shift a linked booking', async () => {
  conflictDay('16:00');
  store.reservation.push({
    id: 'booking',
    tripId: 'trip',
    itineraryItemId: 'new',
    type: 'ACTIVITY',
    localDate: new Date('2026-09-05'),
    localTime: parseLocalTime('16:00'),
    timeZone: 'Asia/Singapore',
  });
  const before = structuredClone(store.itineraryItem);
  const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' });
  expect(response.suggestions[0]!.status).toBe('no_feasible_time');
  expect(response.suggestions[0]!.review).toBeUndefined();
  expect(store.itineraryItem).toEqual(before);
});

test('an explicitly accepted repair retains legacy estimated flexibility', async () => {
  conflictDay('16:00');
  store.itineraryItem[2]!.timingFlexibility = null;
  store.itineraryItem[2]!.timeProvenance = 'AI_ESTIMATED';
  const preview = await getItineraryTimingReview('user', 'trip', 'day', 'b', {
    schedule: 'exact',
    localTime: '12:00',
  });
  await applyItineraryTimingReview('user', 'trip', 'day', {
    ...preview.proposals![0]!,
    itemIds: ['b', 'new'],
  });
  expect(store.itineraryItem[2]!.timingFlexibility).toBe('FLEXIBLE');
});

function aucklandStopTimes() {
  seed();
  store.trip[0]!.referenceTimeZone = 'Pacific/Auckland';
  store.itineraryDay[0]!.defaultTimeZone = 'Pacific/Auckland';
  for (const place of store.place) {
    place.customLatitude = -36.848;
    place.customLongitude = 174.763;
    place.customTimeZone = 'Pacific/Auckland';
  }
}

test('a linked Auckland stop cannot retain a Singapore fallback in the Sylvia Park connection', async () => {
  aucklandStopTimes();
  item('a', 0, '10:00', false);
  item('b', 1, '12:30', false);
  store.itineraryItem[0]!.durationMinutes = 120;
  store.itineraryItem[1]!.durationMinutes = 240;
  store.itineraryItem[1]!.timeZone = 'Pacific/Auckland';
  store.itineraryItem[1]!.startInstant = floatingLocalTimeToInstant(
    '2026-09-05',
    '12:30',
    'Pacific/Auckland',
  );
  vi.mocked(readCachedRoute).mockResolvedValue({
    kind: 'hit',
    result: {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: new Date().toISOString(), source: 'cache' },
      estimate: { durationSeconds: 102, distanceMeters: 100, encodedPolyline: null },
    },
  });
  const before = structuredClone(store.itineraryItem);
  const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(response.issues?.filter((issue) => issue.severity === 'conflict')).toEqual([]);
  expect(store.itineraryItem).toEqual(before);
  store.itineraryItem[1]!.localStartTime = parseLocalTime('11:30');
  store.itineraryItem[1]!.startInstant = floatingLocalTimeToInstant(
    '2026-09-05',
    '11:30',
    'Pacific/Auckland',
  );
  const late = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
  expect(late.issues).toContainEqual(
    expect.objectContaining({
      itemId: 'b',
      code: 'FIXED_CONFLICT',
      orderConflict: expect.objectContaining({
        earliestStartLocal: '2026-09-05T12:02',
      }),
    }),
  );
  expect(getProviderCallCounts()).toEqual({});
});

test.each([false, true])(
  'The Shelf 12:05–15:35 fits Auckland hours with stale Singapore timing (identity expired: %s)',
  async (expiredIdentity) => {
    aucklandStopTimes();
    store.itineraryDay[0]!.date = new Date('2026-09-10');
    item('a', 0, '12:05', false);
    item('b', 1, '16:10', false);
    store.itineraryItem[0]!.durationMinutes = 210;
    store.itineraryItem[1]!.durationMinutes = 30;
    const place = store.place[0]!;
    place.kind = 'PROVIDER';
    place.customLatitude = null;
    place.customLongitude = null;
    place.customTimeZone = null;
    place.providerRefs = [
      {
        provider: 'GOOGLE',
        externalPlaceId: 'shelf',
        cachedAt: expiredIdentity ? new Date('2026-08-01') : new Date(),
        cachedLatitude: -36.848,
        cachedLongitude: 174.763,
        cachedTimeZone: 'Pacific/Auckland',
      },
    ];
    vi.mocked(readCachedPlaceEvidence).mockResolvedValue({
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: new Date().toISOString(), source: 'cache' },
      place: {
        attributions: [],
        category: 'food_and_drink',
        externalPlaceId: 'shelf',
        formattedAddress: null,
        googleMapsUri: null,
        location: { latitude: -36.848, longitude: 174.763 },
        name: 'The Shelf',
        openingPeriods: [
          { open: { day: 4, hour: 7, minute: 0 }, close: { day: 4, hour: 16, minute: 0 } },
        ],
        primaryType: 'cafe',
        provider: 'google',
        rating: null,
        rawTypes: ['cafe'],
        utcOffsetMinutes: 720,
      },
    });
    const before = structuredClone(store.itineraryItem);
    const response = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
    expect(response.issues?.filter((issue) => issue.severity === 'conflict')).toEqual([]);
    const suggestion = await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
      itemId: 'a',
      schedule: 'exact',
      localTime: '12:05',
      durationMinutes: 210,
    });
    expect(suggestion.suggestions[0]).toMatchObject({
      status: 'ok',
      localTime: '12:05',
      localEndTime: '15:35',
    });
    expect(store.itineraryItem).toEqual(before);
    store.itineraryItem[0]!.durationMinutes = 240;
    const tooLong = await getItineraryDayTimeSuggestions('user', 'trip', 'day');
    expect(tooLong.issues).toContainEqual(
      expect.objectContaining({ itemId: 'a', code: 'OPENING_HOURS' }),
    );
    expect(getProviderCallCounts()).toEqual({});
  },
);

test('reading an existing implicit stop corrects its context without writing; a duration edit persists that context', async () => {
  aucklandStopTimes();
  item('a', 0, '12:05', false);
  store.itineraryItem[0]!.durationMinutes = 240;
  const before = structuredClone(store.itineraryItem);
  const itinerary = await listItinerary('user', 'trip', 'en', { cachedOnly: true });
  expect(itinerary.days[0]!.items[0]).toMatchObject({
    localStartTime: '12:05',
    timeZone: 'Pacific/Auckland',
    timeZoneSource: 'place',
    startInstant: '2026-09-05T00:05:00.000Z',
  });
  expect(store.itineraryItem).toEqual(before);
  await updateItineraryItem('user', 'trip', 'a', {
    durationMinutes: 210,
    timingPolicy: 'review_flexible',
  });
  expect(store.itineraryItem[0]).toMatchObject({
    localStartTime: parseLocalTime('12:05'),
    durationMinutes: 210,
    timeZone: 'Pacific/Auckland',
    timeZoneSource: 'PLACE',
    startInstant: new Date('2026-09-05T00:05:00Z'),
  });
  expect(getProviderCallCounts()).toEqual({});
});

test.each(['Asia/Singapore', 'America/New_York', 'Pacific/Auckland', null])(
  'conflict, Suggest timing and apply share local clocks with timezone metadata %s',
  async (zone) => {
    conflictDay('16:00');
    store.itineraryDay[0]!.defaultTimeZone = zone ?? 'UTC';
    store.trip[0]!.referenceTimeZone = 'Pacific/Honolulu';
    for (const [index, row] of store.itineraryItem.entries()) {
      row.timeZone = index % 2 ? 'Europe/London' : zone;
      row.timeZoneSource = 'EXPLICIT';
      // Deliberately inconsistent legacy instants cannot influence a plan.
      row.startInstant = new Date('2030-01-01T23:59:00Z');
    }
    const warning = (await getItineraryDayTimeSuggestions('user', 'trip', 'day')).issues!.find(
      (i) => i.itemId === 'b' && i.code === 'FIXED_CONFLICT',
    )!;
    expect(warning.orderConflict).toEqual({
      previousItemId: 'a',
      earliestStartLocal: '2026-09-05T12:05',
      scheduledStartLocal: '2026-09-05T12:00',
    });
    const suggested = (await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'b' }))
      .suggestions[0]!;
    expect(suggested).toMatchObject({ status: 'ok', localTime: '12:05', localEndTime: '16:05' });
    expect(warning.suggestion?.localTime).toBe(suggested.localTime);
    expect(warning.suggestion?.localEndTime).toBe(suggested.localEndTime);
    const proposal = await getItineraryTimingReview(
      'user',
      'trip',
      'day',
      'b',
      suggested.review!.repair,
    );
    await applyItineraryTimingReview('user', 'trip', 'day', {
      ...proposal.proposals![0]!,
      itemIds: ['b', 'new'],
    });
    expect(store.itineraryItem.find((i) => i.id === 'b')!.localStartTime).toEqual(
      parseLocalTime('12:05'),
    );
    expect(store.itineraryItem.find((i) => i.id === 'new')!.localStartTime).toEqual(
      parseLocalTime('16:10'),
    );
    expect(
      (await getItineraryDayTimeSuggestions('user', 'trip', 'day')).issues?.filter(
        (i) => i.severity === 'conflict',
      ),
    ).toEqual([]);
    expect(getProviderCallCounts()).toEqual({});
  },
);

test('a DST-gap clock can be created, suggested and applied without an instant or timezone prerequisite', async () => {
  seed();
  store.itineraryDay[0]!.date = new Date('2026-09-27');
  store.itineraryDay[0]!.defaultTimeZone = 'Pacific/Auckland';
  store.itineraryDay[0]!.planningContext = {
    intent: null,
    availability: { start: '01:00', end: '06:00' },
  };
  const created = await createItineraryItem('user', 'trip', {
    itineraryDayId: 'day',
    customLabel: 'Early visit',
    customLocation: { label: 'Auckland', timeZone: 'Pacific/Auckland' },
    schedule: { kind: 'exact', localTime: '02:30' },
    localEndTime: '03:30',
    timingPolicy: 'preserve',
  });
  expect(created.localStartTime).toBe('02:30');
  expect(created.durationMinutes).toBe(60);
  expect(created.startInstant).toBeNull();
  const suggestion = (
    await getItineraryDayTimeSuggestions('user', 'trip', 'day', {
      itemId: created.id,
      schedule: 'exact',
      localTime: '02:30',
      localEndTime: '03:30',
    })
  ).suggestions[0]!;
  expect(suggestion).toMatchObject({
    status: 'ok',
    localTime: '02:30',
    localEndTime: '03:30',
    durationMinutes: 60,
  });
  await updateItineraryItem('user', 'trip', created.id, {
    schedule: { kind: 'exact', localTime: suggestion.localTime! },
    localEndTime: suggestion.localEndTime!,
    timingPolicy: 'preserve',
  });
  expect(store.itineraryItem.find((i) => i.id === created.id)).toMatchObject({
    localStartTime: parseLocalTime('02:30'),
    durationMinutes: 60,
    startInstant: null,
  });
  expect(getProviderCallCounts()).toEqual({});
});

test('an explicit end saved under elapsed DST rules is read consistently by cards and suggestions', async () => {
  seed();
  store.itineraryDay[0]!.date = new Date('2026-03-08');
  store.itineraryDay[0]!.defaultTimeZone = 'America/New_York';
  store.itineraryDay[0]!.planningContext = {
    intent: null,
    availability: { start: '00:00', end: '06:00' },
  };
  item('a', 0, '01:30', false);
  store.itineraryItem[0]!.localEndTime = parseLocalTime('03:30');
  store.itineraryItem[0]!.durationMinutes = 60;
  store.itineraryItem[0]!.timeZone = 'America/New_York';
  const before = structuredClone(store.itineraryItem);
  const itinerary = await listItinerary('user', 'trip', 'en', { cachedOnly: true });
  expect(itinerary.days[0]!.items[0]).toMatchObject({
    localStartTime: '01:30',
    localEndTime: '03:30',
    durationMinutes: 120,
  });
  const preview = await getItineraryDayTimeSuggestions('user', 'trip', 'day', { itemId: 'a' });
  expect(preview.suggestions[0]).toMatchObject({
    status: 'ok',
    localTime: '01:30',
    localEndTime: '03:30',
    durationMinutes: 120,
  });
  expect(store.itineraryItem).toEqual(before);
  expect(getProviderCallCounts()).toEqual({});
});
