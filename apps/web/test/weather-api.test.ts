import { beforeEach, expect, test, vi } from 'vitest';

const getSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession } }),
}));

const { getWeather } = await import('../lib/weather/api.ts');

beforeEach(() => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'token' } },
    error: null,
  });
  vi.stubGlobal('navigator', { onLine: true });
});

test('surfaces provider failure when no cached weather can answer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ code: 'weather_provider_unavailable' }),
      ok: false,
      status: 503,
    })),
  );

  await expect(
    getWeather({
      latitude: 35.68,
      longitude: 139.76,
      temperatureUnit: 'celsius',
      timeZone: 'Asia/Tokyo',
    }),
  ).rejects.toMatchObject({ code: 'weather_provider_unavailable', status: 503 });
});
