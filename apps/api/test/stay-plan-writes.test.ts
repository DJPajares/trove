import { beforeEach, expect, test } from 'vitest';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';
installFakePrismaClient();
const { updateTripStayPlan, updateDayStay } = await import('../src/services/stay-plan.js');
const { readPlanScoreInputs } = await import('../src/services/plan-score.js');
const { resolveDayStay } = await import('../src/services/day-stay.js');

beforeEach(() => {
  resetStore();
  store.trip.push({
    id: 'trip',
    ownerId: 'owner',
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-03'),
    referenceTimeZone: 'Asia/Tokyo',
    stayPlanRevision: 0,
  });
  for (const id of ['a', 'b']) {
    store.place.push({ id, kind: 'CUSTOM', customTimeZone: 'Asia/Tokyo', customName: id });
    store.tripPlace.push({ id, tripId: 'trip', placeId: id });
  }
  store.tripPlace.push({ id: 'foreign', tripId: 'other-trip', placeId: 'a' });
  for (let n = 1; n <= 3; n++)
    store.itineraryDay.push({
      id: `d${n}`,
      tripId: 'trip',
      date: new Date(`2026-11-0${n}`),
      dailyBaseTripPlaceId: null,
      dailyBaseDepartureTripPlaceId: null,
      defaultTimeZone: 'Asia/Tokyo',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
    });
});
const plan = { expectedRevision: 0, defaultTripPlaceId: 'a', ranges: [] };

test('foreign owners and places cannot mutate the plan or consume its revision', async () => {
  await expect(updateTripStayPlan('other-owner', 'trip', plan)).rejects.toThrow('trip_not_found');
  await expect(
    updateTripStayPlan('owner', 'trip', { ...plan, defaultTripPlaceId: 'foreign' }),
  ).rejects.toThrow('trip_place_not_found');
  expect(store.trip[0]?.stayPlanRevision).toBe(0);
  expect(store.tripStayRange).toHaveLength(0);
});

test('trip stays update atomically, retain exceptions, and reset only when requested', async () => {
  Object.assign(store.itineraryDay[1]!, {
    dailyBaseTripPlaceId: 'b',
    stayStartMode: 'PLACE',
    stayEndMode: 'SAME_AS_START',
  });
  await updateTripStayPlan('owner', 'trip', plan);
  expect(store.itineraryDay[0]).toMatchObject({
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceTripPlaceId: null,
  });
  expect(store.itineraryDay[1]?.dailyBaseTripPlaceId).toBe('b');
  await updateTripStayPlan('owner', 'trip', {
    ...plan,
    expectedRevision: 1,
    resetDayOverrides: true,
  });
  expect(store.itineraryDay[1]).toMatchObject({
    dailyBaseTripPlaceId: null,
    stayStartMode: 'INHERIT',
    stayEndMode: 'INHERIT',
    defaultTimeZoneSourceTripPlaceId: 'a',
  });
});

test('stale edits cannot overwrite a newer trip or day stay', async () => {
  await updateTripStayPlan('owner', 'trip', plan);
  await expect(
    updateTripStayPlan('owner', 'trip', { ...plan, defaultTripPlaceId: 'b' }),
  ).rejects.toThrow('itinerary_day_conflict');
  await expect(
    updateDayStay('owner', 'trip', 'd1', {
      expectedRevision: 0,
      start: { mode: 'none' },
      end: { mode: 'none' },
    }),
  ).rejects.toThrow('itinerary_day_conflict');
  expect(store.trip[0]).toMatchObject({ defaultStayTripPlaceId: 'a', stayPlanRevision: 1 });
});

test('a no-stay day removes stay timezone context and can restore automatic inheritance', async () => {
  await updateTripStayPlan('owner', 'trip', plan);
  await updateDayStay('owner', 'trip', 'd1', {
    expectedRevision: 1,
    start: { mode: 'none' },
    end: { mode: 'none' },
  });
  expect(store.itineraryDay[0]).toMatchObject({
    stayStartMode: 'NONE',
    stayEndMode: 'NONE',
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceTripPlaceId: null,
  });
  await updateDayStay('owner', 'trip', 'd1', {
    expectedRevision: 2,
    start: { mode: 'inherit' },
    end: { mode: 'inherit' },
  });
  expect(store.itineraryDay[0]).toMatchObject({
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceTripPlaceId: null,
  });
});

test('a return-only change never changes the day timezone', async () => {
  await updateTripStayPlan('owner', 'trip', plan);
  await updateDayStay('owner', 'trip', 'd1', {
    expectedRevision: 1,
    start: { mode: 'inherit' },
    end: { mode: 'place', tripPlaceId: 'b' },
  });
  expect(store.itineraryDay[0]?.defaultTimeZoneSourceTripPlaceId).toBeNull();
  await expect(
    updateDayStay('owner', 'trip', 'foreign-day', {
      expectedRevision: 2,
      start: { mode: 'inherit' },
      end: { mode: 'inherit' },
    }),
  ).rejects.toThrow('itinerary_day_not_found');
  expect(store.trip[0]?.stayPlanRevision).toBe(2);
});

test('a night range changes timezone only on the following morning, including departure', async () => {
  store.place.find((p) => p.id === 'b')!.customTimeZone = 'America/New_York';
  await updateTripStayPlan('owner', 'trip', {
    ...plan,
    ranges: [{ tripPlaceId: 'b', startDate: '2026-11-02', endDate: '2026-11-03' }],
  });
  expect(store.itineraryDay.map((d) => d.defaultTimeZone)).toEqual([
    'Asia/Tokyo',
    'Asia/Tokyo',
    'America/New_York',
  ]);
  await expect(
    updateTripStayPlan('owner', 'trip', {
      ...plan,
      expectedRevision: 1,
      ranges: [{ tripPlaceId: 'b', startDate: '2026-11-03', endDate: '2026-11-04' }],
    }),
  ).rejects.toThrow('invalid_stay_plan');
  expect(store.trip[0]?.stayPlanRevision).toBe(1);
  expect(store.itineraryDay.map((d) => d.defaultTimeZone)).toEqual([
    'Asia/Tokyo',
    'Asia/Tokyo',
    'America/New_York',
  ]);
});

test('scoring hashes effective stay endpoints rather than their storage representation', () => {
  const base = {
    startDate: new Date('2026-11-01'),
    tripPlaces: [{ id: 'a', placeId: 'place-a', priority: null }],
    reservations: [],
    itineraryDays: [
      {
        id: 'd1',
        date: new Date('2026-11-02'),
        dailyBaseTripPlaceId: 'a',
        dailyBaseDepartureTripPlaceId: null,
        defaultTimeZone: 'Asia/Tokyo',
        items: [],
        routeStartTravelMode: 'DRIVE',
      },
    ],
  };
  const defaulted = {
    ...base,
    defaultStayTripPlaceId: 'a',
    defaultStayTripPlace: { id: 'a' },
    itineraryDays: base.itineraryDays.map((d) => ({ ...d, dailyBaseTripPlaceId: null })),
  };
  expect(readPlanScoreInputs(defaulted).revision).toBe(readPlanScoreInputs(base).revision);
  expect(
    readPlanScoreInputs({
      ...defaulted,
      itineraryDays: defaulted.itineraryDays.map((d) => ({
        ...d,
        stayStartMode: 'NONE' as const,
        stayEndMode: 'NONE' as const,
      })),
    }).revision,
  ).not.toBe(readPlanScoreInputs(base).revision);
  expect(
    resolveDayStay(
      {
        id: 'd1',
        date: base.itineraryDays[0]!.date,
        dailyBaseTripPlace: null,
        dailyBaseDepartureTripPlace: null,
      },
      [],
      defaulted,
    ).start?.place.id,
  ).toBe('a');
});
