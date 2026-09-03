import { afterEach, beforeEach, expect, test } from 'vitest';

import type { WeatherDailyForecast } from '../src/services/weather.js';

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

test('a stale snapshot is refetched', async () => {
  const { calls, service } = await createService();
  await service.getForecasts([TOKYO], WINDOW);

  for (const row of store.rows.values()) {
    row.fetchedAt = new Date(NOW.getTime() - 4 * 60 * 60 * 1_000);
  }

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
