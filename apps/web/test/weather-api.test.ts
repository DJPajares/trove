import { beforeEach, expect, test, vi } from 'vitest';

import type { ArchivedTripWeatherDay } from '../lib/weather/history.ts';

const getSession = vi.fn();
const readTripWeatherHistory = vi.fn(async (): Promise<ArchivedTripWeatherDay[]> => []);
const writeTripWeatherHistory = vi.fn(
  async (_userId: string, _tripId: string, _days: ArchivedTripWeatherDay[]) => undefined,
);

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));
vi.mock('@/lib/offline/trip-store', () => ({ readTripWeatherHistory, writeTripWeatherHistory }));

const { getTripWeather } = await import('../lib/weather/api.ts');

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({
    data: { session: { access_token: 'token', user: { id: 'traveller' } } },
    error: null,
  });
  readTripWeatherHistory.mockResolvedValue([]);
  writeTripWeatherHistory.mockResolvedValue(undefined);
});

test('surfaces the provider failure code rather than a generic one', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ code: 'weather_provider_unavailable' }),
      ok: false,
      status: 503,
    })),
  );

  await expect(getTripWeather('trip', { temperatureUnit: 'celsius' })).rejects.toMatchObject({
    code: 'weather_provider_unavailable',
    status: 503,
  });
});

test('asks the trip endpoint once, and varies only by unit', async () => {
  const fetchMock = vi.fn(async () => ({
    json: async () => ({ days: [] }),
    ok: true,
    status: 200,
  }));
  vi.stubGlobal('fetch', fetchMock);

  await getTripWeather('trip-id', { temperatureUnit: 'fahrenheit' });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url] = fetchMock.mock.calls[0]! as unknown as [string];
  expect(url).toContain('/trips/trip-id/weather');
  expect(url).toContain('temperatureUnit=fahrenheit');
  // Every surface must ask the identical question, or crossing between them
  // costs a round trip for a forecast already in hand.
  expect(new URL(url).searchParams.size).toBe(1);
});

test('archives returned daily forecasts and includes a saved past day in the response', async () => {
  const archivedDay = {
    date: '2026-09-20',
    itineraryDayId: 'past-day',
    location: { timeZone: 'Asia/Tokyo' },
    precipitationProbability: 20,
    temperatureMaxCelsius: 24,
    temperatureMinCelsius: 18,
    weatherCode: 2,
  };
  readTripWeatherHistory.mockResolvedValue([archivedDay]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({
        attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com' },
        current: { temperature: 20 },
        days: [
          {
            date: '2026-09-24',
            itineraryDayId: 'future-day',
            location: { latitude: 35.68, longitude: 139.69, timeZone: 'Asia/Tokyo' },
            precipitationProbability: 30,
            temperatureMax: 28,
            temperatureMin: 21,
            weatherCode: 3,
          },
        ],
        fetchedAt: '2026-09-23T00:00:00.000Z',
        horizon: { endDate: '2026-10-08', startDate: '2026-09-23' },
        hours: [{ temperature: 20, time: '2026-09-23T12:00', weatherCode: 1 }],
        hoursDate: '2026-09-23',
        provider: 'open_meteo',
        temperatureUnit: 'celsius',
      }),
      ok: true,
      status: 200,
    })),
  );

  const weather = await getTripWeather('trip-id', { temperatureUnit: 'celsius' });

  expect(weather.days.map((day) => day.date)).toEqual(['2026-09-20', '2026-09-24']);
  expect(weather.current).toEqual({ temperature: 20 });
  expect(weather.hours).toHaveLength(1);
  expect(writeTripWeatherHistory).toHaveBeenCalledWith('traveller', 'trip-id', [
    archivedDay,
    expect.objectContaining({ date: '2026-09-24', itineraryDayId: 'future-day' }),
  ]);
});

test('does not overwrite saved history when the private store cannot be read', async () => {
  readTripWeatherHistory.mockRejectedValue(new Error('offline_storage_unavailable'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ days: [] }),
      ok: true,
      status: 200,
    })),
  );

  await getTripWeather('trip-id', { temperatureUnit: 'celsius' });

  expect(writeTripWeatherHistory).not.toHaveBeenCalled();
});
