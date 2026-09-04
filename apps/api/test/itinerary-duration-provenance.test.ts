import { beforeEach, expect, test } from 'vitest';

import { toDayEvidenceItems } from '../src/services/itinerary-day-evidence.js';
import { createItineraryItem, updateItineraryItem } from '../src/services/itineraries.js';
import { readPlanScoreInputs } from '../src/services/plan-score.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
beforeEach(resetStore);

function seedDay() {
  store.trip.push({
    endDate: new Date('2026-09-06T00:00:00.000Z'),
    id: 'trip',
    name: 'Trip',
    ownerId: 'user',
    referenceTimeZone: 'Asia/Singapore',
    startDate: new Date('2026-09-05T00:00:00.000Z'),
  });
  store.itineraryDay.push({
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: new Date('2026-09-05T00:00:00.000Z'),
    defaultTimeZone: 'Asia/Singapore',
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceItemId: null,
    defaultTimeZoneSourceTripPlaceId: null,
    id: 'day',
    notes: null,
    tripId: 'trip',
  });
}

test('Plan Score treats an AI-estimated duration as estimated evidence', () => {
  const [item] = toDayEvidenceItems(
    {
      commitments: [],
      date: '2026-09-05',
      id: 'day',
      items: [
        {
          dayPart: 'MORNING',
          durationMinutes: 90,
          durationProvenance: 'AI_ESTIMATED',
          id: 'museum',
          localStartTime: null,
          reservationCount: 0,
          startInstant: null,
          timeSemantics: null,
          timeProvenance: null,
          timeZone: null,
          tripPlaceId: null,
        },
      ],
      timeZone: 'Asia/Singapore',
    },
    undefined,
    new Map(),
  );

  expect(item?.duration).toStrictEqual({ minutes: 90, source: 'ESTIMATED' });
});

test('Plan Score keeps AI exact times movable and traveler exact times fixed', () => {
  const baseItem = {
    dayPart: null,
    durationMinutes: 90,
    durationProvenance: 'AI_ESTIMATED',
    localStartTime: new Date('1970-01-01T13:00:00.000Z'),
    reservationCount: 0,
    startInstant: new Date('2026-09-05T05:00:00.000Z'),
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Singapore',
    tripPlaceId: null,
  };
  const items = toDayEvidenceItems(
    {
      commitments: [],
      date: '2026-09-05',
      id: 'day',
      items: [
        { ...baseItem, id: 'ai-time', timeProvenance: 'AI_ESTIMATED' },
        { ...baseItem, id: 'traveler-time', timeProvenance: 'USER_OWNED' },
      ],
      timeZone: 'Asia/Singapore',
    },
    undefined,
    new Map(),
  );

  expect(items[0]).toMatchObject({
    fixed: false,
    start: { minutes: 780, source: 'ESTIMATED' },
  });
  expect(items[1]).toMatchObject({
    fixed: true,
    start: { minutes: 780, source: 'USER_OWNED' },
  });
});

test('manual creation and duration edits persist user-owned provenance', async () => {
  seedDay();
  const created = await createItineraryItem('user', 'trip', {
    customLabel: 'Museum',
    durationMinutes: 60,
    itineraryDayId: 'day',
    schedule: { kind: 'day_part', dayPart: 'morning' },
  });

  expect(created.durationProvenance).toBe('user_owned');

  const stored = store.itineraryItem.find((item) => item.id === created.id);
  if (!stored) throw new Error('missing_itinerary_item');
  stored.durationProvenance = 'AI_ESTIMATED';

  const updated = await updateItineraryItem('user', 'trip', created.id, {
    durationMinutes: 75,
  });

  expect(updated.item.durationProvenance).toBe('user_owned');
  expect(stored.durationProvenance).toBe('USER_OWNED');
});

test('manual timing edits own exact times and clear provenance with the time', async () => {
  seedDay();
  const created = await createItineraryItem('user', 'trip', {
    customLabel: 'Museum',
    durationMinutes: 60,
    itineraryDayId: 'day',
    schedule: { kind: 'exact', localTime: '10:15' },
  });
  const stored = store.itineraryItem.find((item) => item.id === created.id);
  if (!stored) throw new Error('missing_itinerary_item');

  expect(stored.timeProvenance).toBe('USER_OWNED');
  stored.timeProvenance = 'AI_ESTIMATED';

  await updateItineraryItem('user', 'trip', created.id, {
    schedule: { kind: 'exact', localTime: '10:30' },
  });
  expect(stored.timeProvenance).toBe('USER_OWNED');

  await updateItineraryItem('user', 'trip', created.id, {
    schedule: { dayPart: 'afternoon', kind: 'day_part' },
  });
  expect(stored.localStartTime).toBeNull();
  expect(stored.timeProvenance).toBeNull();
});

/**
 * The evidence mapper is only as good as what the readers hand it. Plan Score
 * builds its day records by hand, and the field it forgets is the field the
 * traveller feels: an AI estimate read back as user-owned becomes a commitment
 * nothing is allowed to move.
 */
test('Plan Score reads an applied AI exact time back as a movable estimate', () => {
  const baseItem = {
    _count: { reservations: 0 },
    dayPart: null,
    durationMinutes: 90,
    durationProvenance: 'AI_ESTIMATED',
    localStartTime: new Date('1970-01-01T13:05:00.000Z'),
    position: 0,
    startInstant: new Date('2026-09-05T05:05:00.000Z'),
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Singapore',
    travelModeToNext: null,
    tripPlaceId: null,
  };
  const { days } = readPlanScoreInputs({
    itineraryDays: [
      {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
        date: new Date('2026-09-05T00:00:00.000Z'),
        defaultTimeZone: 'Asia/Singapore',
        id: 'day',
        items: [
          { ...baseItem, id: 'ai-time', timeProvenance: 'AI_ESTIMATED' },
          { ...baseItem, id: 'traveler-time', position: 1, timeProvenance: 'USER_OWNED' },
        ],
        routeStartTravelMode: 'WALK',
      },
    ],
    reservations: [],
    tripPlaces: [],
  });

  const items = toDayEvidenceItems(days[0]!, undefined, new Map());

  expect(items[0]).toMatchObject({ fixed: false, start: { source: 'ESTIMATED' } });
  expect(items[1]).toMatchObject({ fixed: true, start: { source: 'USER_OWNED' } });
});
