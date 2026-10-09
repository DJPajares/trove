import { weatherMemory } from '../src/services/weather-memory.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { WEATHER_CACHE_TTL_MS } from '@trove/types';
import {
  WeatherService,
  type WeatherContext,
  type WeatherProvider,
  type WeatherRequest,
} from '../src/services/weather.js';

const NOW = new Date('2026-10-03T03:00:00Z');
const INPUT: WeatherRequest = {
  latitude: 35.681,
  longitude: 139.767,
  timeZone: 'Asia/Tokyo',
  temperatureUnit: 'celsius',
};
type Row = { fetchedAt: Date; payload: Omit<WeatherContext, 'fetchedAt'> };
let rows: Map<string, Row>;
let fail: { read: boolean; write: boolean };
let upsert: ReturnType<typeof vi.fn>;
let provider: WeatherProvider;
let acquire: ReturnType<typeof vi.fn<WeatherProvider['getWeather']>>;
const key = (point: Record<string, unknown>) => JSON.stringify(point);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  rows = new Map();
  fail = { read: false, write: false };
  upsert = vi.fn(async ({ create }: { create: Row & Record<string, unknown> }) => {
    if (fail.write) throw new Error('write failed');
    const { fetchedAt, payload, ...point } = create;
    rows.set(key(point), { fetchedAt, payload });
  });
  vi.stubGlobal('trovePrismaClient', {
    weatherContextSnapshot: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { weather_context_snapshot_point: Record<string, unknown> };
        }) => {
          if (fail.read) throw new Error('read failed');
          return rows.get(key(where.weather_context_snapshot_point)) ?? null;
        },
      ),
      upsert,
    },
  });
  acquire = vi.fn(async (input: WeatherRequest): Promise<Omit<WeatherContext, 'fetchedAt'>> => ({
    attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com/' },
    current: {
      apparentTemperature: 18,
      temperature: 20,
      observedAt: '2026-10-03T12:00',
      isDay: true,
      weatherCode: 1,
    },
    forecast: [
      {
        date: '2026-10-03',
        temperatureMax: 25,
        temperatureMin: 15,
        precipitationProbability: 20,
        weatherCode: 2,
      },
    ],
    hours: [
      { time: '2026-10-03T13:00', temperature: 22, precipitationProbability: 30, weatherCode: 3 },
    ],
    location: { latitude: input.latitude, longitude: input.longitude, timeZone: input.timeZone },
    provider: 'open_meteo',
    temperatureUnit: input.temperatureUnit,
  }));
  provider = { getWeather: acquire, getDailyForecasts: vi.fn(async () => []) };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('separate service instances reuse evidence without renewing its timestamps', async () => {
  const first = await new WeatherService(provider).getWeather(INPUT);
  vi.setSystemTime(new Date(NOW.getTime() + WEATHER_CACHE_TTL_MS - 1));
  const second = await new WeatherService(provider).getWeather(INPUT);
  expect(second).toEqual(first);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(second.current?.observedAt).toBe('2026-10-03T12:00');
});

test('expiry at exactly one hour acquires a new response', async () => {
  await new WeatherService(provider).getWeather(INPUT);
  vi.setSystemTime(new Date(NOW.getTime() + WEATHER_CACHE_TTL_MS));
  const result = await new WeatherService(provider).getWeather(INPUT);
  expect(acquire).toHaveBeenCalledTimes(2);
  expect(result.fetchedAt).toBe(new Date(NOW.getTime() + WEATHER_CACHE_TTL_MS).toISOString());
});

test('GPS jitter and unit changes share Celsius evidence without mutating it', async () => {
  const service = new WeatherService(provider);
  const celsius = await service.getWeather(INPUT);
  const fahrenheit = await service.getWeather({
    ...INPUT,
    latitude: 35.6809,
    longitude: 139.7671,
    temperatureUnit: 'fahrenheit',
  });
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(acquire.mock.calls[0]![0]).toMatchObject({
    temperatureUnit: 'celsius',
    latitude: 35.68,
    longitude: 139.77,
  });
  expect(fahrenheit.current).toMatchObject({ temperature: 68, apparentTemperature: 64.4 });
  expect(fahrenheit.forecast[0]).toMatchObject({ temperatureMax: 77, temperatureMin: 59 });
  expect(fahrenheit.hours[0]?.temperature).toBeCloseTo(71.6);
  expect(await service.getWeather(INPUT)).toEqual(celsius);
});

test('different locations and timezones acquire separate evidence', async () => {
  const service = new WeatherService(provider);
  await service.getWeather(INPUT);
  await service.getWeather({ ...INPUT, latitude: 43.06 });
  await service.getWeather({ ...INPUT, timeZone: 'UTC' });
  expect(acquire).toHaveBeenCalledTimes(3);
});

test('concurrent service instances share acquisition and the awaited write', async () => {
  await Promise.all(
    Array.from({ length: 8 }, () => new WeatherService(provider).getWeather(INPUT)),
  );
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(upsert).toHaveBeenCalledTimes(1);
});

test.each(['read', 'write'] as const)(
  'cache %s failure still returns acquired weather',
  async (failure) => {
    fail[failure] = true;
    expect(await new WeatherService(provider).getWeather(INPUT)).toMatchObject({
      current: { temperature: 20 },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
  },
);

test('provider failure preserves expired dated forecasts with their original age', async () => {
  const service = new WeatherService(provider);
  const first = await service.getWeather(INPUT);
  vi.setSystemTime(new Date(NOW.getTime() + WEATHER_CACHE_TTL_MS));
  acquire.mockRejectedValueOnce(new Error('provider failed'));
  const fallback = await service.getWeather(INPUT);
  expect(fallback).toMatchObject({
    current: null,
    hours: [],
    fetchedAt: first.fetchedAt,
    forecast: first.forecast,
  });
  expect(upsert).toHaveBeenCalledTimes(1);
  await service.getWeather(INPUT);
  expect(acquire).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5 * 60_000);
  await service.getWeather(INPUT);
  expect(acquire).toHaveBeenCalledTimes(3);
});

test('provider failure without a stored forecast propagates and permits retry', async () => {
  acquire.mockRejectedValueOnce(new Error('provider failed'));
  const service = new WeatherService(provider);
  await expect(service.getWeather(INPUT)).rejects.toThrow('provider failed');
  await expect(service.getWeather(INPUT)).rejects.toThrow('provider failed');
  vi.advanceTimersByTime(5 * 60_000);
  await expect(service.getWeather(INPUT)).resolves.toMatchObject({ current: { temperature: 20 } });
});

test.each(['future', 'malformed'] as const)(
  '%s snapshots cannot be served as fresh evidence',
  async (kind) => {
    const service = new WeatherService(provider);
    await service.getWeather(INPUT);
    const row = [...rows.values()][0]!;
    if (kind === 'future') row.fetchedAt = new Date(NOW.getTime() + 1);
    else row.payload = {} as Row['payload'];
    weatherMemory().clear();
    await service.getWeather(INPUT);
    expect(acquire).toHaveBeenCalledTimes(2);
  },
);
