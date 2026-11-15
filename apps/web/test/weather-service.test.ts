import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  WEATHER_CACHE_POLICY,
  weatherLocationKey,
  type WeatherLocation,
  type WeatherLocations,
  type WeatherPointEvidence,
  type WeatherResolvePoint,
  type TripContext,
  weatherForecastWindow,
  weatherLocalDate,
} from '@trove/types';
import type { TripWeather } from '../lib/weather/api.ts';
import { LocalWeatherService, type WeatherTransport } from '../lib/weather/service.ts';
import {
  createWeatherStorage,
  withWeatherLocks,
  weatherStorageKey,
} from '../lib/weather/storage.ts';
import {
  clearAllOfflineTripData,
  claimWeatherLease,
  releaseWeatherLease,
  readQueryCacheEntry,
  writeQueryCacheEntry,
} from '../lib/offline/trip-store.ts';
import { FakeIndexedDbFactory } from './fake-indexed-db.ts';
import { tripWeatherUnit } from '../lib/weather/client-service.ts';
import { migratePersistedWeather } from '../lib/weather/migrate.ts';

const NOW = Date.parse('2026-10-03T03:00:00Z');
const TOKYO: WeatherLocation = { latitude: 35.681, longitude: 139.767, timeZone: 'Asia/Tokyo' };
const OSAKA = { ...TOKYO, latitude: 34.69, longitude: 135.5 };
let now: number;
let mappings: Map<string, WeatherLocations>;
let transport: WeatherTransport;
let services: LocalWeatherService[];
const forecast = (date: string, fetchedAt = new Date(now).toISOString()) => ({
  date,
  fetchedAt,
  temperatureMax: 25,
  temperatureMin: 15,
  weatherCode: 2,
  precipitationProbability: 20,
});
function evidence(point: WeatherResolvePoint): WeatherPointEvidence {
  return {
    location: point,
    days: ['2026-10-03', '2026-10-04', '2026-10-05'].map((date) => forecast(date)),
    current: point.current
      ? {
          observedAt: '2026-10-03T12:00',
          temperature: 20,
          apparentTemperature: 19,
          weatherCode: 1,
          isDay: true,
        }
      : null,
    hours: [],
    currentFetchedAt: point.current ? new Date(now).toISOString() : null,
  };
}
function mapping(location = TOKYO, date = '2026-10-03', id = 'day'): WeatherLocations {
  return { days: [{ id, date, location }], fallback: location };
}
function service(userId = 'traveller', derived = true, online = () => true) {
  const value = new LocalWeatherService({
    userId,
    storage: createWeatherStorage(userId),
    transport,
    lock: (keys, signal, work) => withWeatherLocks(userId, keys, signal, work),
    now: () => now,
    online,
    mapping: derived ? async (id) => mappings.get(id) ?? null : undefined,
  });
  services.push(value);
  return value;
}
async function settled() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
beforeEach(async () => {
  now = NOW;
  services = [];
  mappings = new Map([
    ['trip', mapping()],
    ['other', mapping(TOKYO, '2026-10-03', 'other-day')],
  ]);
  vi.stubGlobal('indexedDB', new FakeIndexedDbFactory());
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { localStorage: { removeItem: vi.fn() } }),
  );
  await clearAllOfflineTripData();
  transport = {
    locations: vi.fn(async (id) => mappings.get(id)!),
    resolve: vi.fn(async (points) => points.map(evidence)),
    location: vi.fn(async () => {
      throw new Error('unexpected Home request');
    }),
    trip: vi.fn(async (id: string): Promise<TripWeather> => {
      const trip = mappings.get(id)!;
      const at = new Date(now);
      const window = weatherForecastWindow(
        trip.days.flatMap((day) => (day.location ? [day.location.timeZone] : [])),
        at,
      );
      const days = trip.days.flatMap((day) =>
        day.location && day.date >= window.startDate && day.date <= window.endDate
          ? [
              {
                ...forecast(day.date, at.toISOString()),
                itineraryDayId: day.id,
                location: day.location,
              },
            ]
          : [],
      );
      const today = days.find((day) => day.date === weatherLocalDate(at, day.location.timeZone));
      return {
        attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com/' },
        current: today
          ? {
              observedAt: '2026-10-03T12:00',
              temperature: 20,
              apparentTemperature: 19,
              weatherCode: 1,
              isDay: true,
            }
          : null,
        currentFetchedAt: today ? at.toISOString() : null,
        days,
        fetchedAt: at.toISOString(),
        horizon: window,
        hours: [],
        hoursDate: today?.date ?? null,
        provider: 'open_meteo',
        temperatureUnit: 'celsius',
      };
    }),
    context: vi.fn(async (): Promise<TripContext> => ({
      version: 2,
      days: [],
      holidays: [],
      climate: [
        {
          area: { latitude: 35.7, longitude: 139.8 },
          fetchedAt: new Date(now).toISOString(),
          month: 10,
          years: { from: 2021, to: 2025 },
          dayIds: ['day'],
          temperatureMaxC: 25,
          temperatureMinC: 15,
          wetDayShare: 0.2,
        },
      ],
    })),
  };
});
afterEach(() => {
  services.forEach((value) => value.dispose());
  vi.unstubAllGlobals();
});

test('a closed-tab lease expires and another owner cannot release it', async () => {
  const key = weatherStorageKey('traveller', 'lease:point');
  expect(await claimWeatherLease(key, 'closed', Date.now() + 45_000)).toBe(true);
  await releaseWeatherLease(key, 'other');
  expect(await claimWeatherLease(key, 'other', Date.now() + 45_000)).toBe(false);
  await writeQueryCacheEntry(key, JSON.stringify({ owner: 'closed', expiresAt: Date.now() - 1 }));
  expect(await claimWeatherLease(key, 'other', Date.now() + 45_000)).toBe(true);
});

test('seasonal context survives reload beyond 24 hours and retains source age for 30 days', async () => {
  await service().context('trip', 'en');
  now += 2 * 86_400_000;
  const context = await service().context('trip', 'en');
  expect(context.climate[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(transport.context).toHaveBeenCalledTimes(1);
  now = NOW + WEATHER_CACHE_POLICY.seasonalMs;
  await service().context('trip', 'en');
  await settled();
  expect(transport.context).toHaveBeenCalledTimes(2);
});

test('negative seasonal context retries after cooldown instead of becoming a 30-day positive hit', async () => {
  vi.mocked(transport.context).mockResolvedValue({
    version: 2,
    days: [],
    holidays: [],
    climate: [],
  });
  const cache = service();
  await cache.context('trip', 'en');
  await cache.context('trip', 'en');
  expect(transport.context).toHaveBeenCalledTimes(1);
  now += WEATHER_CACHE_POLICY.retryMs;
  await cache.context('trip', 'en');
  await settled();
  expect(transport.context).toHaveBeenCalledTimes(2);
});

test('legacy migration converts units and keeps compatible source timestamps without inventing provenance', async () => {
  const serialized = JSON.stringify({
    clientState: {
      queries: [
        {
          queryKey: ['location-weather', 35.68, 139.77, 'v5', 'fahrenheit', 'Asia/Tokyo'],
          state: {
            data: {
              fetchedAt: new Date(NOW).toISOString(),
              location: TOKYO,
              current: null,
              forecast: [{ ...forecast('2026-10-03'), temperatureMax: 77, temperatureMin: 59 }],
            },
          },
        },
        {
          queryKey: ['trip-weather', 'legacy'],
          state: {
            data: {
              fetchedAt: new Date(NOW).toISOString(),
              days: [{ ...forecast('2026-10-03'), location: { timeZone: 'UTC' } }],
            },
          },
        },
      ],
    },
  });
  const migrated = await migratePersistedWeather('traveller', serialized);
  expect(JSON.parse(migrated).clientState.queries).toEqual([]);
  const saved = await createWeatherStorage('traveller').read<WeatherPointEvidence>(
    `point:${weatherLocationKey(TOKYO)}`,
  );
  expect(saved?.days[0]?.temperatureMax).toBe(25);
  expect(saved?.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(
    await readQueryCacheEntry(weatherStorageKey('another', `point:${weatherLocationKey(TOKYO)}`)),
  ).toBeNull();
});

test('sign-out forgets the account so an old QueryClient cannot recreate a weather service', async () => {
  const { bindWeatherAccount, disposeWeatherAccount, getWeatherService } =
    await import('../lib/weather/client-service.ts');
  const client = new QueryClient();
  const original = bindWeatherAccount(client, 'old');
  disposeWeatherAccount(client); // React StrictMode cleanup is followed by setup on the same client.
  expect(getWeatherService(client)).not.toBe(original);
  disposeWeatherAccount(client, true);
  expect(() => getWeatherService(client)).toThrow('not_authenticated');
  bindWeatherAccount(client, 'new');
  expect(() => getWeatherService(client)).not.toThrow();
  disposeWeatherAccount(client, true);
  client.clear();
});

test('active lease owners renew while waiting; completion releases the lease', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  let release!: () => void;
  const controller = new AbortController(),
    key = weatherStorageKey('traveller', 'lease:renewal');
  const work = withWeatherLocks(
    'traveller',
    ['renewal'],
    controller.signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await settled();
    await vi.advanceTimersByTimeAsync(WEATHER_CACHE_POLICY.leaseMs + 1);
    expect(await claimWeatherLease(key, 'other', Date.now() + WEATHER_CACHE_POLICY.leaseMs)).toBe(
      false,
    );
    release();
    await work;
    expect(await claimWeatherLease(key, 'other', Date.now() + WEATHER_CACHE_POLICY.leaseMs)).toBe(
      true,
    );
  } finally {
    controller.abort();
    vi.useRealTimers();
  }
});

test('a trip read after a reload uses the kept copy, with no request', async () => {
  const first = service(),
    client = new QueryClient();
  await client.fetchQuery({
    queryKey: ['trip-weather', 'trip'],
    queryFn: () => first.trip('trip'),
  });
  first.dispose();
  client.clear();
  const reloaded = service(),
    newClient = new QueryClient();
  const data = await newClient.fetchQuery({
    queryKey: ['trip-weather', 'trip'],
    queryFn: () => reloaded.trip('trip'),
  });
  expect(data.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(transport.trip).toHaveBeenCalledTimes(1);
  expect(transport.locations).not.toHaveBeenCalled();
  newClient.clear();
});

test('a trip converts units on display and asks the server once', async () => {
  const cache = service();
  const trip = await cache.trip('trip');
  expect(tripWeatherUnit(trip, 'fahrenheit').days[0]?.temperatureMax).toBe(77);
  expect(trip.days[0]?.temperatureMax).toBe(25);
  expect(transport.trip).toHaveBeenCalledTimes(1);
  expect(transport.resolve, 'a trip no longer resolves points itself').not.toHaveBeenCalled();
});

test('simultaneous readers and two tabs ask the server once', async () => {
  const a = service(),
    b = service();
  await Promise.all([a.trip('trip'), a.trip('trip'), b.trip('trip')]);
  expect(transport.trip).toHaveBeenCalledTimes(1);
});

test('Web Locks serialize tabs and the second rereads what the first kept', async () => {
  const queues = new Map<string, Promise<unknown>>();
  const request = vi.fn(async (key: string, _options: unknown, work: () => Promise<unknown>) => {
    const next = (queues.get(key) ?? Promise.resolve()).then(work);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  });
  vi.stubGlobal('navigator', { onLine: true, locks: { request } });
  await Promise.all([service().trip('trip'), service().trip('trip')]);
  expect(transport.trip).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalled();
});

test("today's live reading goes stale after an hour while the days stay", async () => {
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  const stale = await cache.trip('trip');
  expect(stale.current).toBeNull();
  expect(stale.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  await settled();
  expect(transport.trip).toHaveBeenCalledTimes(2);
  expect((await cache.trip('trip')).current).not.toBeNull();
});

test('days ahead are not asked for again until a day arrives', async () => {
  mappings.set('trip', mapping(TOKYO, '2026-10-04'));
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.forecastMs;
  await cache.trip('trip');
  expect(transport.trip, 'no timer refresh for a day ahead').toHaveBeenCalledTimes(1);
  now = Date.parse('2026-10-03T15:00:05Z'); // Just past midnight in Tokyo: the day arrives.
  await cache.trip('trip');
  await settled();
  expect(transport.trip).toHaveBeenCalledTimes(2);
});

test('hidden and offline reads answer from the kept copy and ask nothing', async () => {
  let online = true;
  const cache = service('traveller', true, () => online);
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  vi.stubGlobal('document', { hidden: true });
  await cache.trip('trip');
  vi.stubGlobal('document', { hidden: false });
  online = false;
  expect((await cache.trip('trip')).days).toHaveLength(1);
  expect(transport.trip).toHaveBeenCalledTimes(1);
  online = true;
  await cache.trip('trip');
  await settled();
  expect(transport.trip).toHaveBeenCalledTimes(2);
});

test('a day beyond the horizon is asked for again once it can be forecast', async () => {
  mappings.set('trip', mapping(TOKYO, '2026-11-03'));
  const cache = service();
  const unavailable = await cache.trip('trip');
  await cache.trip('trip');
  expect(unavailable.days).toEqual([]);
  expect(transport.trip).toHaveBeenCalledTimes(1);
  expect(unavailable.refreshAfter).toBeGreaterThan(now);
  now = Date.parse('2026-10-19T00:00:00Z');
  await cache.trip('trip');
  await settled();
  expect(transport.trip).toHaveBeenCalledTimes(2);
});

test('a trip whose places move is asked for again', async () => {
  const cache = service();
  await cache.trip('trip');
  mappings.set('trip', mapping(OSAKA));
  expect((await cache.trip('trip')).days[0]?.location.latitude).toBe(OSAKA.latitude);
  expect(transport.trip).toHaveBeenCalledTimes(2);
});

test('metadata mappings persist and are fetched only when missing', async () => {
  await service('traveller', false).trip('trip');
  await service('traveller', false).trip('trip');
  expect(transport.locations).toHaveBeenCalledTimes(1);
  expect(transport.trip).toHaveBeenCalledTimes(1);
});

test('a failed read keeps the kept copy and tries again after the pause', async () => {
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  vi.mocked(transport.trip).mockRejectedValue(new Error('server unavailable'));
  await cache.trip('trip');
  await settled();
  const kept = await service().trip('trip');
  expect(kept.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(kept.current).toBeNull();
  expect(transport.trip).toHaveBeenCalledTimes(2);
  now += WEATHER_CACHE_POLICY.retryMs;
  await cache.trip('trip');
  await settled();
  expect(transport.trip).toHaveBeenCalledTimes(3);
});

test('without device storage a trip is still kept in memory', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const cache = service();
  await cache.trip('trip');
  await cache.trip('trip');
  expect(transport.trip).toHaveBeenCalledTimes(1);
});

test('a new reading notifies assessments once; reuse and unit conversion do not', async () => {
  const acquired = vi.fn();
  const cache = new LocalWeatherService({
    userId: 'traveller',
    storage: createWeatherStorage('traveller'),
    transport,
    mapping: async (id) => mappings.get(id) ?? null,
    now: () => now,
    lock: (_keys, _signal, work) => work(),
    onEvidence: acquired,
  });
  services.push(cache);
  const first = await cache.trip('trip');
  expect(acquired).toHaveBeenCalledTimes(1);
  await cache.trip('trip');
  tripWeatherUnit(first, 'fahrenheit');
  expect(acquired).toHaveBeenCalledTimes(1);
});

test('a new reading is broadcast to another tab without a second request', async () => {
  const first = service(),
    second = service(),
    changed: string[] = [];
  second.subscribe((key) => changed.push(key));
  first.subscribe(() => undefined);
  await first.trip('trip');
  await second.trip('trip');
  changed.length = 0;
  now += WEATHER_CACHE_POLICY.currentMs;
  await first.trip('trip');
  await vi.waitFor(() => expect(changed).toContain('trip:trip'));
  await second.trip('trip');
  expect(transport.trip).toHaveBeenCalledTimes(2);
});
