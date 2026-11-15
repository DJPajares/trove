import { expect, test } from 'vitest';

import type { TripWeather, TripWeatherDay } from '@/lib/weather/api';
import { dayForecast, forecastGap } from '@/lib/weather/trip-forecast';

function day(date: string, overrides: Partial<TripWeatherDay> = {}): TripWeatherDay {
  return {
    date,
    fetchedAt: '2026-10-15T00:00:00Z',
    itineraryDayId: date,
    location: { timeZone: 'Indian/Maldives' },
    precipitationProbability: 40,
    temperatureMax: 29,
    temperatureMin: 26,
    weatherCode: 61,
    ...overrides,
  };
}

function weather(days: TripWeatherDay[]): TripWeather {
  return {
    attribution: { label: 'Weather data by Open-Meteo.com', url: 'https://open-meteo.com' },
    current: null,
    days,
    fetchedAt: '2026-10-15T00:00:00Z',
    horizon: { endDate: '2026-10-29', startDate: '2026-10-15' },
    hours: [],
    hoursDate: null,
    provider: 'open_meteo',
    temperatureUnit: 'celsius',
  };
}

test('a day is forecast, later, past or missing - and nothing else', () => {
  const trip = weather([day('2026-10-12', { archived: true }), day('2026-10-16')]);
  expect(dayForecast(trip, '2026-10-16')?.state).toBe('forecast');
  expect(dayForecast(trip, '2026-11-12')).toEqual({ forecast: null, state: 'later' });
  expect(dayForecast(trip, '2026-10-10')).toEqual({ forecast: null, state: 'past' });
  expect(dayForecast(trip, '2026-10-20')).toEqual({ forecast: null, state: 'missing' });
  expect(dayForecast(null, '2026-10-16')).toBeNull();
});

test('a day already gone reads the same as a day ahead', () => {
  const trip = weather([day('2026-10-12', { archived: true }), day('2026-10-14')]);
  expect(dayForecast(trip, '2026-10-12')?.state).toBe('forecast');
  expect(dayForecast(trip, '2026-10-14')?.state).toBe('forecast');
});

test('a trip-wide forecast explains its gaps once, furthest-out reason first', () => {
  expect(forecastGap(['forecast', 'later', 'past'])).toBe('later');
  expect(forecastGap(['forecast', 'missing', 'past'])).toBe('missing');
  expect(forecastGap(['forecast', 'past'])).toBe('past');
  expect(forecastGap(['forecast', 'forecast'])).toBeNull();
});
