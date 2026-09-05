import { expect, test } from 'vitest';

import { OpenMeteoWeatherProvider, WeatherProviderError } from '../src/services/weather.js';
import {
  WEATHER_FORECAST_HORIZON_DAYS,
  isWithinForecastWindow,
  resolveForecastWindow,
} from '../src/services/weather-window.js';

const NOW = new Date('2026-09-03T15:00:00.000Z');

function dailyBlock(dates: string[]) {
  return {
    precipitation_probability_max: dates.map(() => 20),
    temperature_2m_max: dates.map(() => 24),
    temperature_2m_min: dates.map(() => 16),
    time: dates,
    weather_code: dates.map(() => 3),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

test('the forecast window covers today plus the provider horizon', () => {
  const window = resolveForecastWindow(['Asia/Tokyo'], NOW);

  // 15:00Z on 3 September is already 4 September in Tokyo, so the window opens
  // on Tokyo's today. It does not close on Tokyo's today plus the horizon: the
  // provider counts from its own, which is still the 3rd, and answers a request
  // for the 19th by rejecting the whole batch. Whichever end comes first binds.
  expect(window.startDate).toBe('2026-09-04');
  expect(window.endDate).toBe('2026-09-18');
  expect(WEATHER_FORECAST_HORIZON_DAYS).toBe(15);
});

test('a zone east of UTC cannot ask past the provider’s own last day', () => {
  // The shape that took weather down in production: every trip day in one
  // eastward zone, read after the zone had rolled over but before UTC had.
  // Measured from local time alone this ends on the 19th, which is a day the
  // provider does not have and answers with a 400 for the entire trip.
  for (const timeZone of ['Asia/Singapore', 'Asia/Bangkok', 'Pacific/Auckland']) {
    const window = resolveForecastWindow([timeZone], NOW);

    expect(window.endDate).toBe('2026-09-18');
  }
});

test('before the rollover the local and provider horizons agree', () => {
  // Earlier the same UTC day, Singapore still shares UTC's date, so nothing is
  // clamped and the window is the full fortnight from today.
  const window = resolveForecastWindow(['Asia/Singapore'], new Date('2026-09-03T01:00:00.000Z'));

  expect(window.startDate).toBe('2026-09-03');
  expect(window.endDate).toBe('2026-09-18');
});

test('a zone west of UTC keeps its own earlier start', () => {
  // The clamp only ever moves the end. A zone behind UTC opens the window on
  // its own yesterday, which the provider serves months of.
  const window = resolveForecastWindow(['Pacific/Honolulu'], NOW);

  expect(window.startDate).toBe('2026-09-03');
  expect(window.endDate).toBe('2026-09-18');
});

test('a mixed-zone window ends at the earliest zone horizon, not the latest', () => {
  const window = resolveForecastWindow(['Asia/Tokyo', 'America/Los_Angeles'], NOW);

  // Los Angeles is still on 3 September, so its horizon runs out first. Ending
  // on Tokyo's 19th would put the request a day past what Los Angeles allows,
  // and the provider rejects the whole batch rather than trimming it.
  expect(window.startDate).toBe('2026-09-03');
  expect(window.endDate).toBe('2026-09-18');
});

test('a day outside the window is not reachable', () => {
  const window = resolveForecastWindow(['UTC'], NOW);

  expect(isWithinForecastWindow('2026-09-03', window)).toBe(true);
  expect(isWithinForecastWindow('2026-09-18', window)).toBe(true);
  expect(isWithinForecastWindow('2026-09-19', window)).toBe(false);
  expect(isWithinForecastWindow('2026-09-02', window)).toBe(false);
});

test('every point is answered by a single outbound request', async () => {
  const requests: string[] = [];
  const provider = new OpenMeteoWeatherProvider({
    fetcher: async (input) => {
      requests.push(String(input));
      return jsonResponse([
        { daily: dailyBlock(['2026-09-03']), timezone: 'Asia/Tokyo' },
        { daily: dailyBlock(['2026-09-03']), location_id: 1, timezone: 'Europe/Paris' },
        { daily: dailyBlock(['2026-09-03']), location_id: 2, timezone: 'America/New_York' },
      ]);
    },
  });

  const forecasts = await provider.getDailyForecasts({
    endDate: '2026-09-03',
    points: [
      { latitude: 35.68, longitude: 139.69 },
      { latitude: 48.85, longitude: 2.35 },
      { latitude: 40.71, longitude: -74.01 },
    ],
    startDate: '2026-09-03',
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain('latitude=35.68%2C48.85%2C40.71');
  expect(requests[0]).toContain('timezone=auto');
  // Celsius on the wire is fixed, so a unit preference never reaches the cache key.
  expect(requests[0]).toContain('temperature_unit=celsius');
  expect(forecasts.map((forecast) => forecast.location.timeZone)).toEqual([
    'Asia/Tokyo',
    'Europe/Paris',
    'America/New_York',
  ]);
});

test('a single point still answers, even though it comes back unwrapped', async () => {
  const provider = new OpenMeteoWeatherProvider({
    fetcher: async () => jsonResponse({ daily: dailyBlock(['2026-09-03']), timezone: 'UTC' }),
  });

  const forecasts = await provider.getDailyForecasts({
    endDate: '2026-09-03',
    points: [{ latitude: 51.5, longitude: -0.13 }],
    startDate: '2026-09-03',
  });

  expect(forecasts).toHaveLength(1);
  expect(forecasts[0]!.days[0]!.date).toBe('2026-09-03');
});

test('an answer whose points arrive out of order is refused rather than mismatched', async () => {
  const provider = new OpenMeteoWeatherProvider({
    fetcher: async () =>
      jsonResponse([
        { daily: dailyBlock(['2026-09-03']), location_id: 1, timezone: 'Europe/Paris' },
        { daily: dailyBlock(['2026-09-03']), timezone: 'Asia/Tokyo' },
      ]),
  });

  // Handing Paris's forecast to Tokyo is worse than having none.
  await expect(
    provider.getDailyForecasts({
      endDate: '2026-09-03',
      points: [
        { latitude: 35.68, longitude: 139.69 },
        { latitude: 48.85, longitude: 2.35 },
      ],
      startDate: '2026-09-03',
    }),
  ).rejects.toBeInstanceOf(WeatherProviderError);
});

test('no points means no request at all', async () => {
  let calls = 0;
  const provider = new OpenMeteoWeatherProvider({
    fetcher: async () => {
      calls += 1;
      return jsonResponse([]);
    },
  });

  await expect(
    provider.getDailyForecasts({ endDate: '2026-09-03', points: [], startDate: '2026-09-03' }),
  ).resolves.toEqual([]);
  expect(calls).toBe(0);
});

test('an out-of-range date range surfaces as an invalid request', async () => {
  const provider = new OpenMeteoWeatherProvider({
    fetcher: async () =>
      jsonResponse({ error: true, reason: "Parameter 'end_date' is out of allowed range" }, 400),
  });

  await expect(
    provider.getDailyForecasts({
      endDate: '2026-12-01',
      points: [{ latitude: 35.68, longitude: 139.69 }],
      startDate: '2026-09-03',
    }),
  ).rejects.toMatchObject({ code: 'invalid_request' });
});
