import { weatherMemory } from '../src/services/weather-memory.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { WeatherProviderError, type WeatherDailyForecast } from '../src/services/weather.js';

const WINDOW = { endDate: '2026-09-06', startDate: '2026-09-03' };
const NOW = new Date('2026-09-03T09:00:00.000Z');
const TOKYO = { latitude: 35.681, longitude: 139.767 };

type SnapshotRow = {
  days: {
    date: Date;
    precipitationProbability: number | null;
    temperatureMaxCelsius: number;
    temperatureMinCelsius: number;
    weatherCode: number;
  }[];
  fetchedAt: Date;
  id: string;
  latitude: number;
  longitude: number;
  provider: string;
  timeZone: string;
};

/**
 * An in-memory stand-in for the Prisma tables, keyed the way the real unique
 * index is, plus switches for the two failure modes the service must absorb.
 */
function createStore() {
  const rows = new Map<string, SnapshotRow>();
  const fail = { read: false, write: false };
  const key = (where: { latitude: number; longitude: number; provider: string }) =>
    `${where.provider}:${where.latitude},${where.longitude}`;

  const client = {
    async $transaction(run: (transaction: unknown) => unknown) {
      if (fail.write) throw new Error('write failed');
      return run(client);
    },
    weatherForecastSnapshot: {
      async findUnique({ where }: { where: { weather_forecast_snapshot_point: never } }) {
        if (fail.read) throw new Error('read failed');
        return rows.get(key(where.weather_forecast_snapshot_point)) ?? null;
      },
      async upsert({ create }: { create: Omit<SnapshotRow, 'days' | 'id'> }) {
        const id = key(create);
        rows.set(id, { ...create, days: [], id });
        return { id };
      },
    },
    weatherForecastSnapshotDay: {
      async createMany({
        data,
      }: {
        data: (SnapshotRow['days'][number] & { snapshotId: string })[];
      }) {
        const row = rows.get(data[0]!.snapshotId);
        if (row) row.days = data;
        return { count: data.length };
      },
      async deleteMany({ where }: { where: { snapshotId: string } }) {
        const row = rows.get(where.snapshotId);
        if (row) row.days = [];
        return { count: 0 };
      },
    },
  };

  return { client, fail, rows };
}

function createProvider(days: string[]) {
  const calls: { points: number }[] = [];

  return {
    calls,
    provider: {
      async getDailyForecasts({
        points,
      }: {
        points: readonly { latitude: number; longitude: number }[];
      }) {
        calls.push({ points: points.length });
        return points.map((point) => ({
          days: days.map<WeatherDailyForecast>((date) => ({
            date,
            precipitationProbability: 30,
            temperatureMax: 24,
            temperatureMin: 16,
            weatherCode: 3,
          })),
          location: { ...point, timeZone: 'Asia/Tokyo' },
          point,
        }));
      },
      async getWeather() {
        throw new Error('the daily cache must not ask for current conditions');
      },
    },
  };
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = store.client;
});

afterEach(() => {
  delete (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient;
});

async function createService(days = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']) {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { calls, provider } = createProvider(days);
  return {
    calls,
    service: new CachedWeatherService(provider, () => NOW, 'weather'),
  };
}

test('a cold cache fetches once and answers from the snapshot afterwards', async () => {
  const { calls, service } = await createService();

  const first = await service.getForecasts([TOKYO], WINDOW);
  expect(calls).toHaveLength(1);
  expect([...first.values()][0]!.days).toHaveLength(4);

  const second = await service.getForecasts([TOKYO], WINDOW);
  expect(calls, 'a warm snapshot must not reach the provider').toHaveLength(1);
  expect([...second.values()][0]!.days).toHaveLength(4);
});

test('two coordinates in the same city share one snapshot', async () => {
  const { calls, service } = await createService();

  await service.getForecasts([TOKYO], WINDOW);
  // A few hundred metres away: the same weather, and after rounding the same row.
  await service.getForecasts([{ latitude: 35.6809, longitude: 139.7671 }], WINDOW);

  expect(calls).toHaveLength(1);
  expect(store.rows.size).toBe(1);
});

test('concurrent daily requests share acquisition and snapshot persistence', async () => {
  const { service, calls } = await createService();
  const writes = vi.spyOn(store.client, '$transaction');
  await Promise.all(Array.from({ length: 8 }, () => service.getForecasts([TOKYO], WINDOW)));
  expect(calls).toHaveLength(1);
  expect(writes).toHaveBeenCalledTimes(1);
});

test('a stale snapshot is refetched', async () => {
  const { calls, service } = await createService();
  await service.getForecasts([TOKYO], WINDOW);

  for (const row of store.rows.values()) {
    row.fetchedAt = new Date(NOW.getTime() - 4 * 60 * 60 * 1_000);
  }

  weatherMemory().clear();
  await service.getForecasts([TOKYO], WINDOW);
  expect(calls).toHaveLength(2);
});

test('a snapshot that no longer reaches the end of the window is refetched', async () => {
  // Written yesterday, so it stops a day short of what today's window asks for.
  const { calls, service } = await createService(['2026-09-03', '2026-09-04', '2026-09-05']);

  await service.getForecasts([TOKYO], WINDOW);
  await service.getForecasts([TOKYO], WINDOW);

  expect(calls, 'an incomplete snapshot must not quietly shorten the trip').toHaveLength(2);
});

test('a cache that cannot be read still answers', async () => {
  const { calls, service } = await createService();
  store.fail.read = true;

  const answers = await service.getForecasts([TOKYO], WINDOW);

  expect(calls).toHaveLength(1);
  expect(answers.size).toBe(1);
});

test('a cache that cannot be written still answers', async () => {
  const { calls, service } = await createService();
  store.fail.write = true;

  const answers = await service.getForecasts([TOKYO], WINDOW);

  expect(calls).toHaveLength(1);
  expect(answers.size).toBe(1);
});

test('a mixed batch fetches only the points that are missing', async () => {
  const { calls, service } = await createService();
  await service.getForecasts([TOKYO], WINDOW);

  await service.getForecasts([TOKYO, { latitude: 43.06, longitude: 141.35 }], WINDOW);

  expect(calls).toEqual([{ points: 1 }, { points: 1 }]);
});

function createFailingProvider() {
  const calls: number[] = [];

  return {
    calls,
    provider: {
      async getDailyForecasts({ points }: { points: readonly unknown[] }) {
        calls.push(points.length);
        throw new WeatherProviderError('invalid_request', {
          reason: "Parameter 'end_date' is out of allowed range from 2026-06-04 to 2026-09-20",
        });
      },
      async getWeather() {
        throw new Error('the daily cache must not ask for current conditions');
      },
    },
  };
}

test('a refused forecast falls back to the snapshot already stored', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { provider } = createProvider(['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);

  // Warm the cache, then come back long enough later that the snapshot has aged
  // out of the freshness window and the service would ordinarily refetch.
  await new CachedWeatherService(provider, () => NOW, 'weather').getForecasts([TOKYO], WINDOW);

  const later = new Date(NOW.getTime() + 4 * 60 * 60 * 1_000);
  const failing = createFailingProvider();
  const answers = await new CachedWeatherService(
    failing.provider,
    () => later,
    'weather',
  ).getForecasts([TOKYO], WINDOW);

  expect(failing.calls, 'the provider is still asked before falling back').toHaveLength(1);
  expect([...answers.values()][0]!.days).toHaveLength(4);
  // The answer is honestly dated, so the surfaces can say how old it is.
  expect([...answers.values()][0]!.fetchedAt).toEqual(NOW);
});

test('a refused forecast with nothing stored says so rather than going quiet', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const failing = createFailingProvider();

  await expect(
    new CachedWeatherService(failing.provider, () => NOW, 'weather').getForecasts([TOKYO], WINDOW),
  ).rejects.toThrow();
});

test('overlapping batches coalesce shared points and batch their database reads', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const findUnique = vi.spyOn(store.client.weatherForecastSnapshot, 'findUnique');
  const findMany = vi.fn(async () => []);
  Object.assign(store.client.weatherForecastSnapshot, { findMany });
  const { provider } = createProvider(['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
  const acquire = vi.spyOn(provider, 'getDailyForecasts');
  const osaka = { latitude: 34.69, longitude: 135.5 },
    sapporo = { latitude: 43.06, longitude: 141.35 };
  const first = new CachedWeatherService(provider, () => NOW);
  const second = new CachedWeatherService(provider, () => NOW);
  await Promise.all([
    first.getForecasts([TOKYO, osaka], WINDOW),
    second.getForecasts([TOKYO, sapporo], WINDOW),
  ]);
  const points = acquire.mock.calls.flatMap(([request]) => request.points);
  expect(points.filter((point) => point.latitude === TOKYO.latitude)).toHaveLength(1);
  expect(points).toHaveLength(3);
  expect(findMany).toHaveBeenCalledTimes(2);
  expect(findUnique).not.toHaveBeenCalled();
  await second.getForecasts([TOKYO, osaka, sapporo], WINDOW);
  expect(findMany).toHaveBeenCalledTimes(2);
  expect(acquire).toHaveBeenCalledTimes(2);
});

test('upcoming snapshots have six-hour freshness while active-day snapshots expire at one hour', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { provider, calls } = createProvider([
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
  let now = NOW;
  const cache = new CachedWeatherService(provider, () => now);
  await cache.getForecasts([TOKYO], WINDOW);
  now = new Date(NOW.getTime() + 60 * 60_000);
  await cache.getForecasts([TOKYO], { startDate: '2026-09-05', endDate: '2026-09-06' });
  expect(calls).toHaveLength(1);
  await cache.getForecasts([TOKYO], WINDOW);
  expect(calls).toHaveLength(2);
  now = new Date(now.getTime() + 6 * 60 * 60_000 - 1);
  await cache.getForecasts([TOKYO], { startDate: '2026-09-05', endDate: '2026-09-06' });
  expect(calls).toHaveLength(2);
  now = new Date(now.getTime() + 1);
  await cache.getForecasts([TOKYO], { startDate: '2026-09-05', endDate: '2026-09-06' });
  expect(calls).toHaveLength(3);
});

test('live acquisition seeds daily series for simultaneous daily resolution without a second provider call', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { WeatherResolver } = await import('../src/services/weather-resolver.js');
  const { WeatherService } = await import('../src/services/weather.js');
  const location = { ...TOKYO, timeZone: 'Asia/Tokyo' };
  const { provider: daily } = createProvider([
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
  const getDailyForecasts = vi.spyOn(daily, 'getDailyForecasts');
  const getWeather = vi.fn(async () => ({
    attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com/' },
    current: null,
    hours: [],
    location,
    provider: 'open_meteo' as const,
    temperatureUnit: 'celsius' as const,
    forecast: (
      await createProvider(['2026-09-03', '2026-09-04']).provider.getDailyForecasts({
        points: [TOKYO],
      })
    )[0]!.days,
  }));
  const forecasts = new CachedWeatherService({ ...daily, getWeather }, () => new Date());
  const resolver = new WeatherResolver(
    forecasts,
    new WeatherService({ ...daily, getWeather }),
    () => new Date(),
  );
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const [live, future] = await Promise.all([
      resolver.resolve([{ ...location, dates: ['2026-09-03'], current: true }]),
      resolver.resolve([{ ...location, dates: ['2026-09-04'] }]),
    ]);
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(getDailyForecasts).not.toHaveBeenCalled();
    expect(live[0]?.days[0]?.fetchedAt).toBe(NOW.toISOString());
    expect(future[0]?.days[0]?.fetchedAt).toBe(NOW.toISOString());
  } finally {
    vi.useRealTimers();
  }
});

test('resolver excludes out-of-horizon dates before weather database or provider lookup', async () => {
  const { WeatherResolver } = await import('../src/services/weather-resolver.js');
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { provider } = createProvider([]);
  const getForecasts = vi.spyOn(CachedWeatherService.prototype, 'getForecasts');
  const read = vi.spyOn(store.client.weatherForecastSnapshot, 'findUnique');
  const response = await new WeatherResolver(
    new CachedWeatherService(provider, () => NOW),
    undefined,
    () => NOW,
  ).resolve([{ ...TOKYO, timeZone: 'Asia/Tokyo', dates: ['2027-01-01'], current: true }]);
  expect(response[0]?.days).toEqual([]);
  expect(getForecasts).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test('a live failure suppresses overlapping daily acquisition for the same point until cooldown', async () => {
  const { CachedWeatherService } = await import('../src/services/cached-weather.js');
  const { WeatherResolver } = await import('../src/services/weather-resolver.js');
  const { WeatherService } = await import('../src/services/weather.js');
  const { provider } = createProvider(['2026-09-03']);
  const getDailyForecasts = vi.spyOn(provider, 'getDailyForecasts');
  const getWeather = vi.fn(async () => {
    throw new Error('provider unavailable');
  });
  const shared = { ...provider, getWeather };
  const resolver = new WeatherResolver(
    new CachedWeatherService(shared, () => new Date()),
    new WeatherService(shared),
    () => new Date(),
  );
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const request = [{ ...TOKYO, timeZone: 'Asia/Tokyo', dates: ['2026-09-03'], current: true }];
    await expect(resolver.resolve(request)).rejects.toThrow('provider unavailable');
    await expect(resolver.resolve(request)).rejects.toThrow('provider unavailable');
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(getDailyForecasts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(resolver.resolve(request)).rejects.toThrow('provider unavailable');
    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(getDailyForecasts).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
