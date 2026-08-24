import { beforeEach, expect, test } from 'vitest';

import { updateItineraryDayName } from '../src/services/itineraries.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();

const USER_ID = 'user';
const TRIP_ID = 'trip';
const DAY_ID = 'day';

beforeEach(() => {
  resetStore();
  store.trip.push({ id: TRIP_ID, ownerId: USER_ID });
  store.itineraryDay.push({ id: DAY_ID, name: null, tripId: TRIP_ID });
});

test('saves a trimmed, date-bound itinerary day name', async () => {
  await expect(
    updateItineraryDayName(USER_ID, TRIP_ID, DAY_ID, '  Golden Hour Photography  '),
  ).resolves.toStrictEqual({ id: DAY_ID, name: 'Golden Hour Photography' });

  expect(store.itineraryDay[0]?.name).toBe('Golden Hour Photography');
});

test('clears an itinerary day name with null', async () => {
  store.itineraryDay[0]!.name = 'Chill Beach Day';

  await expect(updateItineraryDayName(USER_ID, TRIP_ID, DAY_ID, null)).resolves.toStrictEqual({
    id: DAY_ID,
    name: null,
  });
  expect(store.itineraryDay[0]?.name).toBeNull();
});
