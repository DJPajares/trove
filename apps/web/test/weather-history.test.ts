import { expect, test } from 'vitest';

import {
  dateIsBeforeForecastWindow,
  mergeArchivedTripWeather,
  restoreArchivedTripWeather,
} from '../lib/weather/history.ts';
import type { TripWeatherDay } from '../lib/weather/api.ts';

function day(
  itineraryDayId: string,
  date: string,
  temperatureMax: number,
  temperatureMin: number,
): TripWeatherDay {
  return {
    date,
    itineraryDayId,
    location: { timeZone: 'Asia/Tokyo' },
    precipitationProbability: 20,
    temperatureMax,
    temperatureMin,
    weatherCode: 2,
  };
}

test('keeps past day summaries while fresh readings replace the same trip day', () => {
  const oldDay = day('day-1', '2026-09-20', 24, 18);
  const updatedDay = day('day-1', '2026-09-20', 26, 19);
  const upcomingDay = day('day-2', '2026-09-24', 28, 21);

  const archived = mergeArchivedTripWeather([], [oldDay], 'celsius');
  const merged = mergeArchivedTripWeather(archived, [updatedDay, upcomingDay], 'celsius');

  expect(restoreArchivedTripWeather(merged, 'celsius')).toEqual([updatedDay, upcomingDay]);
  expect(Object.keys(merged[0]!).sort()).toEqual([
    'date',
    'itineraryDayId',
    'location',
    'precipitationProbability',
    'temperatureMaxCelsius',
    'temperatureMinCelsius',
    'weatherCode',
  ]);
});

test('restores archived temperatures in the traveller’s current unit', () => {
  const archived = mergeArchivedTripWeather([], [day('day-1', '2026-09-20', 20, 10)], 'celsius');

  expect(restoreArchivedTripWeather(archived, 'fahrenheit')).toMatchObject([
    { temperatureMax: 68, temperatureMin: 50 },
  ]);
});

test('identifies dates before the current provider window', () => {
  const horizon = { startDate: '2026-09-23' };

  expect(dateIsBeforeForecastWindow(horizon, '2026-09-22')).toBe(true);
  expect(dateIsBeforeForecastWindow(horizon, '2026-09-23')).toBe(false);
  expect(dateIsBeforeForecastWindow(null, '2026-09-22')).toBe(false);
});
