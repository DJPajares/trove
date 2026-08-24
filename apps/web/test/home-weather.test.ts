import { expect, test } from 'vitest';

import type { TripModeContext } from '../lib/itinerary/api.ts';
import { resolveHomeWeatherTarget, selectHomeWeatherReading } from '../lib/home/weather.ts';
import type { Trip } from '../lib/trips/api.ts';
import type { CachedWeatherContext } from '../lib/weather/api.ts';

const trip = {
  endDate: '2026-09-12',
  lifecycle: 'active',
  referenceTimeZone: 'Asia/Tokyo',
  startDate: '2026-09-10',
  weatherLocation: { latitude: 35.68, longitude: 139.76, timeZone: 'Asia/Tokyo' },
} as Trip;

function context(): TripModeContext {
  const item = (id: string, latitude: number) => ({
    id,
    timeZone: null,
    tripPlace: {
      place: { location: { latitude, longitude: 2.35, timeZone: 'Europe/Paris' } },
    },
  });
  return {
    currentOrRelevant: { itemId: 'current', kind: 'current', reason: 'exact_time' },
    day: {
      date: '2026-09-10',
      defaultTimeZone: 'Europe/Paris',
      id: 'day',
      items: [item('current', 48.86), item('next', 48.87)],
    },
    nextItemId: 'next',
    selectedDate: '2026-09-10',
  } as TripModeContext;
}

const weather = {
  current: {
    apparentTemperature: 21,
    isDay: true,
    observedAt: '2026-09-10T10:00:00.000Z',
    temperature: 22,
    weatherCode: 1,
  },
  forecast: [
    {
      date: '2026-09-10',
      precipitationProbability: 20,
      temperatureMax: 24,
      temperatureMin: 16,
      weatherCode: 2,
    },
  ],
  source: 'live',
  stale: false,
} as CachedWeatherContext;

test('uses the active current item before the next item and destination fallback', () => {
  expect(resolveHomeWeatherTarget(trip, context())?.location.latitude).toBe(48.86);
});

test('uses the first located destination when active itinerary items lack coordinates', () => {
  const emptyContext = context();
  emptyContext.day!.items = [];
  expect(resolveHomeWeatherTarget(trip, emptyContext)?.location).toStrictEqual(
    trip.weatherLocation,
  );
});

test('omits weather when no eligible coordinates exist', () => {
  expect(resolveHomeWeatherTarget({ ...trip, weatherLocation: null }, null)).toBeNull();
});

test('uses current conditions for the active local date', () => {
  const target = resolveHomeWeatherTarget(trip, context())!;
  expect(selectHomeWeatherReading(weather, target, new Date('2026-09-10T10:00:00.000Z')).kind).toBe(
    'current',
  );
});

test('uses an exact departure forecast and reports out-of-range dates truthfully', () => {
  const planning = { ...trip, lifecycle: 'planning', startDate: '2026-09-10' } as Trip;
  const target = resolveHomeWeatherTarget(planning, null)!;
  expect(selectHomeWeatherReading(weather, target).kind).toBe('forecast');
  expect(selectHomeWeatherReading(weather, { ...target, date: '2026-10-10' }).kind).toBe(
    'out_of_range',
  );
});

test('keeps stale cache readings identifiable to the weather surface', () => {
  const staleWeather = { ...weather, source: 'cache', stale: true } as CachedWeatherContext;
  const target = resolveHomeWeatherTarget(trip, context())!;
  expect(staleWeather.stale).toBe(true);
  expect(
    selectHomeWeatherReading(staleWeather, target, new Date('2026-09-10T10:00:00.000Z')).kind,
  ).toBe('current');
});
