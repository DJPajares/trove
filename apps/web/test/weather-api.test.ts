import { beforeEach, expect, test, vi } from 'vitest';

const getSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));

const { getTripWeather } = await import('../lib/weather/api.ts');

beforeEach(() => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'token' } },
    error: null,
  });
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
