import { afterEach, expect, test, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

import {
  forecastForDate,
  isArchivedForecast,
  isCurrentReadingStale,
  observationInstant,
  selectLocationWeather,
  selectTripWeather,
  WEATHER_CURRENT_MAX_AGE_MS,
} from '../lib/weather/freshness.ts';
import type { LocationWeather, TripWeather } from '../lib/weather/api.ts';

const NOW = new Date('2026-10-03T03:00:00Z'); // Noon in Tokyo, regardless of device zone.
function tripWeather(): TripWeather {
  return {
    attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com' },
    current: {
      observedAt: '2026-10-03T11:45',
      temperature: 23,
      apparentTemperature: 23,
      weatherCode: 1,
      isDay: true,
    },
    days: [
      {
        date: '2026-10-03',
        itineraryDayId: 'today',
        location: { timeZone: 'Asia/Tokyo' },
        temperatureMax: 25,
        temperatureMin: 16,
        weatherCode: 2,
        precipitationProbability: 20,
      },
    ],
    fetchedAt: '2026-10-02T20:00:00Z',
    horizon: { startDate: '2026-10-03', endDate: '2026-10-18' },
    hours: [
      { time: '2026-10-03T12:00', temperature: 24, weatherCode: 2, precipitationProbability: 20 },
    ],
    hoursDate: '2026-10-03',
    provider: 'open_meteo',
    temperatureUnit: 'celsius',
  };
}
function locationWeather(): LocationWeather {
  const trip = tripWeather();
  return {
    attribution: trip.attribution,
    current: trip.current,
    fetchedAt: trip.fetchedAt,
    location: { latitude: 35, longitude: 139, timeZone: 'Asia/Tokyo' },
    place: { name: 'Tokyo' },
    forecast: trip.days.map(({ itineraryDayId: _id, location: _location, ...day }) => day),
  };
}
afterEach(() => vi.useRealTimers());

test('the three-hour window uses the observation and preserves its exact boundary', () => {
  const observed = '2026-10-03T09:00';
  expect(isCurrentReadingStale(observed, 'Asia/Tokyo', NOW)).toBe(false);
  expect(isCurrentReadingStale(observed, 'Asia/Tokyo', new Date(NOW.getTime() + 1))).toBe(true);
  expect(WEATHER_CURRENT_MAX_AGE_MS).toBe(10_800_000);
});

test('re-reading an unchanged response updates query receipt age without renewing its observation', () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const client = new QueryClient();
  const key = ['trip-weather'];
  const weather = tripWeather();
  client.setQueryData(key, weather);
  const firstReceipt = client.getQueryState(key)!.dataUpdatedAt;
  expect(selectTripWeather(weather, '2026-10-03', false).current).not.toBeNull();
  vi.setSystemTime(new Date(NOW.getTime() + WEATHER_CURRENT_MAX_AGE_MS));
  client.setQueryData(key, weather);
  expect(client.getQueryState(key)!.dataUpdatedAt).toBeGreaterThan(firstReceipt);
  const selected = selectTripWeather(client.getQueryData<TripWeather>(key)!, '2026-10-03', false);
  expect(selected.current).toBeNull();
  expect(selected.readings).toEqual([]);
  expect(selected.forecast?.temperatureMax).toBe(25);
  client.clear();
});

test('fresh observations survive older daily forecast retrieval times', () => {
  const weather = tripWeather();
  const result = selectTripWeather(weather, '2026-10-03', false, NOW);
  expect(result.current).toBe(weather.current);
  expect(result.readings).toHaveLength(1);
  expect(result.forecast?.fetchedAt).toBe(weather.fetchedAt);
});

test('a newer observation restores current conditions without changing forecast age', () => {
  const weather = tripWeather();
  weather.current!.observedAt = '2026-10-03T08:00';
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBeNull();
  weather.current!.observedAt = '2026-10-03T11:45';
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBe(weather.current);
  expect(weather.fetchedAt).toBe('2026-10-02T20:00:00Z');
});

test.each([
  '',
  'bad-date',
  '2026-02-30T12:00',
  '2026-10-03T25:00',
  '2026-10-03T12:99',
  '2026-10-03T12:00:99',
])('invalid observation %s cannot be current', (observed) => {
  expect(isCurrentReadingStale(observed, 'Asia/Tokyo', NOW)).toBe(true);
});

test('missing, invalid, and future context cannot support current claims', () => {
  expect(isCurrentReadingStale(undefined, 'Asia/Tokyo', NOW)).toBe(true);
  expect(isCurrentReadingStale('2026-10-03T11:45', null, NOW)).toBe(true);
  expect(isCurrentReadingStale('2026-10-03T11:45', 'Invalid/Zone', NOW)).toBe(true);
  expect(isCurrentReadingStale('2026-10-03T12:01', 'Asia/Tokyo', NOW)).toBe(true);
  expect(isCurrentReadingStale('2026-10-03T11:45', 'Asia/Tokyo', new Date(NaN))).toBe(true);
});

test('wall clocks convert independently of device zone, including fractional offsets and date rollover', () => {
  expect(observationInstant('2026-10-03T11:45', 'Asia/Tokyo')).toBe(
    Date.parse('2026-10-03T02:45Z'),
  );
  expect(observationInstant('2026-10-03T08:30', 'Asia/Kathmandu')).toBe(
    Date.parse('2026-10-03T02:45Z'),
  );
  expect(observationInstant('2026-10-03T00:45', 'Pacific/Auckland')).toBe(
    Date.parse('2026-10-02T11:45Z'),
  );
  expect(observationInstant('2026-10-03T02:45:00Z', 'Asia/Tokyo')).toBe(
    Date.parse('2026-10-03T02:45Z'),
  );
});

test('DST folds and gaps are unknown, while explicit offsets disambiguate them', () => {
  expect(observationInstant('2026-11-01T01:30', 'America/New_York')).toBeNull();
  expect(observationInstant('2026-03-08T02:30', 'America/New_York')).toBeNull();
  expect(observationInstant('2026-04-05T01:45', 'Australia/Lord_Howe')).toBeNull();
  expect(observationInstant('2026-11-01T01:30:00-04:00', 'America/New_York')).toBe(
    Date.parse('2026-11-01T05:30Z'),
  );
  expect(observationInstant('2026-11-01T03:30', 'America/New_York')).toBe(
    Date.parse('2026-11-01T08:30Z'),
  );
});

test('Preview and another selected date never borrow today’s observation or hours', () => {
  const weather = tripWeather();
  expect(selectTripWeather(weather, '2026-10-03', true, NOW)).toMatchObject({
    current: null,
    readings: [],
  });
  expect(selectTripWeather(weather, '2026-10-04', false, NOW)).toMatchObject({
    current: null,
    readings: [],
    forecast: null,
  });
  weather.hoursDate = null;
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBeNull();
});

test('observation timezone comes from its own date, not the selected date', () => {
  const weather = tripWeather();
  weather.days.push({
    ...weather.days[0]!,
    date: '2026-10-04',
    itineraryDayId: 'tomorrow',
    location: { timeZone: 'Pacific/Auckland' },
  });
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBe(weather.current);
  expect(selectTripWeather(weather, '2026-10-04', false, NOW).current).toBeNull();
  weather.days[0]!.location.timeZone = 'Invalid/Zone';
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBeNull();
});

test('archived predictions stay forecasts and legacy archives keep unknown retrieval age', () => {
  const weather = tripWeather();
  const past = { ...weather.days[0]!, date: '2026-10-02', itineraryDayId: 'past' };
  weather.days.push(past);
  expect(isArchivedForecast(past, NOW)).toBe(true);
  expect(forecastForDate(weather, past.date)?.fetchedAt).toBeUndefined();
  expect(selectTripWeather(weather, past.date, false, NOW).current).toBeNull();
  weather.days[0]!.archived = true;
  expect(selectTripWeather(weather, '2026-10-03', false, NOW).current).toBeNull();
});

test('Home chooses fresh current conditions, then today’s local forecast, then date-only', () => {
  const weather = locationWeather();
  expect(selectLocationWeather(weather, NOW)?.kind).toBe('current');
  weather.current!.observedAt = '2026-10-03T08:00';
  expect(selectLocationWeather(weather, NOW)).toMatchObject({
    kind: 'forecast',
    forecast: { date: '2026-10-03', temperatureMax: 25, temperatureMin: 16 },
  });
  weather.forecast = [];
  expect(selectLocationWeather(weather, NOW)).toBeNull();
  weather.location.timeZone = 'Invalid/Zone';
  expect(selectLocationWeather(weather, NOW)).toBeNull();
});

test('legacy location payloads without daily forecasts degrade without throwing', () => {
  const weather = locationWeather();
  weather.current = null;
  delete (weather as Partial<LocationWeather>).forecast;
  expect(selectLocationWeather(weather, NOW)).toBeNull();
});
