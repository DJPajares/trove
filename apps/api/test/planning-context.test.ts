import { beforeEach, expect, test } from 'vitest';
import {
  dayPlanningContextSchema,
  effectiveTripPace,
  planningPreferencesFromAi,
  readTripPlanningPreferences,
  tripPlanningPreferencesSchema,
} from '@trove/types';
import { updateItineraryDayPlanningContext } from '../src/services/itineraries.js';
import { createReservation, updateReservation } from '../src/services/reservations.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
beforeEach(() => {
  resetStore();
  store.trip.push({ id: 'trip', ownerId: 'owner', referenceTimeZone: 'UTC' });
  store.itineraryDay.push({ id: 'day', tripId: 'trip' });
});

test('missing trip preferences disclose balanced as a default and never fabricate interests', () => {
  const value = readTripPlanningPreferences(null);
  expect(value).toEqual({ pace: null, interests: [], unmatchedInterests: [] });
  expect(effectiveTripPace(value)).toEqual({ pace: 'balanced', source: 'default' });
  expect(effectiveTripPace({ ...value, pace: 'balanced' })).toEqual({
    pace: 'balanced',
    source: 'user',
  });
  expect(
    tripPlanningPreferencesSchema.safeParse({ ...value, interests: ['invented'] }).success,
  ).toBe(false);
});

test('explicit AI preferences are retained and unmatched text does not become a deterministic match', () => {
  expect(
    planningPreferencesFromAi(
      { pace: 'relaxed', interests: ['History', 'Bird watching'] },
      true,
      false,
    ),
  ).toEqual({
    pace: 'relaxed',
    interests: ['culture_history'],
    unmatchedInterests: ['Bird watching'],
  });
  expect(
    planningPreferencesFromAi({ pace: 'balanced', interests: ['museums'] }, false, true),
  ).toEqual({ pace: null, interests: [], unmatchedInterests: [] });
});

test('day intent and availability are optional, validated, persisted, and owner-authorized', async () => {
  const context = dayPlanningContextSchema.parse({
    intent: 'rest',
    availability: { start: '10:00', end: '16:00' },
  });
  await expect(updateItineraryDayPlanningContext('owner', 'trip', 'day', context)).resolves.toEqual(
    { id: 'day', planningContext: context },
  );
  expect(store.itineraryDay[0]?.planningContext).toEqual(context);
  await expect(
    updateItineraryDayPlanningContext('intruder', 'trip', 'day', context),
  ).rejects.toThrow('trip_not_found');
  for (const availability of [
    { start: '16:00', end: '10:00' },
    { start: '10:00' },
    { start: '25:00', end: '26:00' },
  ])
    expect(dayPlanningContextSchema.safeParse({ intent: null, availability }).success).toBe(false);
});

test('structured transport preserves overnight dates and distinct endpoint zones, including authoritative instants', async () => {
  const reservation = await createReservation('owner', 'trip', {
    title: 'Overnight train',
    type: 'train',
    transport: {
      departure: { localDate: '2026-10-01', localTime: '23:00', timeZone: 'Asia/Singapore' },
      arrival: { authoritativeInstant: '2026-10-02T00:00:00Z', timeZone: 'Asia/Tokyo' },
    },
  });
  expect(reservation.transport?.departure).toMatchObject({
    localDate: '2026-10-01',
    localTime: '23:00',
    timeZone: 'Asia/Singapore',
    authoritativeInstant: null,
  });
  expect(reservation.transport?.arrival).toEqual({
    localDate: '2026-10-02',
    localTime: '09:00',
    timeZone: 'Asia/Tokyo',
    authoritativeInstant: '2026-10-02T00:00:00.000Z',
  });
  const edited = await updateReservation('owner', 'trip', reservation.id, {
    title: 'Renamed train',
  });
  expect(edited.transport).toEqual(reservation.transport);
});

test('missing arrivals stay unknown, and impossible local times or reversed journeys are rejected', async () => {
  const departure = { localDate: '2026-10-01', localTime: '23:00', timeZone: 'UTC' };
  const reservation = await createReservation('owner', 'trip', {
    title: 'Train',
    type: 'train',
    transport: { departure },
  });
  expect(reservation.transport?.arrival).toBeNull();
  await expect(
    createReservation('owner', 'trip', {
      title: 'Train',
      type: 'train',
      transport: { departure, arrival: { ...departure, localTime: '22:00' } },
    }),
  ).rejects.toThrow('invalid_transport_details');
  await expect(
    createReservation('owner', 'trip', {
      title: 'Train',
      type: 'train',
      transport: {
        departure: { localDate: '2026-03-08', localTime: '02:30', timeZone: 'America/New_York' },
      },
    }),
  ).rejects.toThrow('invalid_transport_details');
  await expect(
    createReservation('intruder', 'trip', {
      title: 'Train',
      type: 'train',
      transport: { departure },
    }),
  ).rejects.toThrow('trip_not_found');
});
