import { expect, test } from 'vitest';

import type { TripModeContext } from '../lib/itinerary/api.ts';
import { resolveHomeWeatherTarget, selectHomeWeatherReading } from '../lib/home/weather.ts';
import type { Trip } from '../lib/trips/api.ts';
import type { TripWeather } from '../lib/weather/api.ts';

const trip = {
  endDate: '2026-09-12',
  id: 'trip-id',
  lifecycle: 'active',
  referenceTimeZone: 'Asia/Tokyo',
  startDate: '2026-09-10',
} as Trip;

/**
 * Only the day Trip Mode is showing still matters here. Where that day is, and
 * therefore what the weather over it is, is the server's question now.
 */
function context(): TripModeContext {
  return { selectedDate: '2026-09-11' } as unknown as TripModeContext;
}

const weather = {
  current: {
    apparentTemperature: 21,
    isDay: true,
    observedAt: '2026-09-11T10:00:00.000Z',
    temperature: 22,
    weatherCode: 1,
  },
  days: [
    {
      date: '2026-09-11',
      itineraryDayId: 'day',
      location: { latitude: 48.86, longitude: 2.35, timeZone: 'Europe/Paris' },
      precipitationProbability: 20,
      temperatureMax: 24,
      temperatureMin: 16,
      weatherCode: 2,
    },
  ],
  fetchedAt: '2026-09-11T09:00:00.000Z',
  horizon: { endDate: '2026-09-26', startDate: '2026-09-11' },
} as TripWeather;

test('an active trip asks about the day Trip Mode is showing', () => {
  const target = resolveHomeWeatherTarget(trip, context());
  expect(target).toStrictEqual({ date: '2026-09-11', kind: 'current', tripId: 'trip-id' });
});

test('a trip still being planned asks about the day it starts', () => {
  const planning = { ...trip, lifecycle: 'planning' } as Trip;
  expect(resolveHomeWeatherTarget(planning, null)).toStrictEqual({
    date: '2026-09-10',
    kind: 'forecast',
    tripId: 'trip-id',
  });
});

test('a finished trip has no weather to speak about', () => {
  expect(resolveHomeWeatherTarget({ ...trip, lifecycle: 'completed' } as Trip, null)).toBeNull();
});

test('uses current conditions for the active local date', () => {
  const target = resolveHomeWeatherTarget(trip, context())!;
  expect(selectHomeWeatherReading(weather, target, new Date('2026-09-11T10:00:00.000Z')).kind).toBe(
    'current',
  );
});

test('a day that is today somewhere else is still a forecast here', () => {
  const target = resolveHomeWeatherTarget(trip, context())!;
  // Paris is a day behind the target date at this instant, so calling the
  // reading "current" would be a claim about a day that has not started.
  expect(selectHomeWeatherReading(weather, target, new Date('2026-09-10T10:00:00.000Z')).kind).toBe(
    'forecast',
  );
});

test('uses an exact departure forecast and reports out-of-range dates truthfully', () => {
  const planning = { ...trip, lifecycle: 'planning', startDate: '2026-09-11' } as Trip;
  const target = resolveHomeWeatherTarget(planning, null)!;
  expect(selectHomeWeatherReading(weather, target).kind).toBe('forecast');
  expect(selectHomeWeatherReading(weather, { ...target, date: '2026-10-10' }).kind).toBe(
    'out_of_range',
  );
});

test('a reading is never current when the server sent no current conditions', () => {
  // The API withholds `current` rather than falling back to a three-hour-old
  // snapshot, and the ribbon must not promote a forecast into its place.
  const withoutCurrent = { ...weather, current: null } as TripWeather;
  const target = resolveHomeWeatherTarget(trip, context())!;
  expect(
    selectHomeWeatherReading(withoutCurrent, target, new Date('2026-09-11T10:00:00.000Z')).kind,
  ).toBe('forecast');
});
