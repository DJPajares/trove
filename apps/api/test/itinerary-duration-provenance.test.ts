import { beforeEach, expect, test } from 'vitest';

import { toDayEvidenceItems } from '../src/services/itinerary-day-evidence.js';
import { createItineraryItem, updateItineraryItem } from '../src/services/itineraries.js';
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
