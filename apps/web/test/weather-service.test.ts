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
} from '@trove/types';
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

test('fresh memory and a new QueryClient after reload reuse IndexedDB with zero weather HTTP calls', async () => {
  const first = service(),
    client = new QueryClient();
  await client.fetchQuery({
    queryKey: ['trip-weather', 'trip'],
    queryFn: () => first.trip('trip'),
  });
  await first.trip('trip');
  first.dispose();
  client.clear();
  const reloaded = service(),
    newClient = new QueryClient();
  const data = await newClient.fetchQuery({
    queryKey: ['trip-weather', 'trip'],
    queryFn: () => reloaded.trip('trip'),
  });
  expect(data.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  expect(transport.locations).not.toHaveBeenCalled();
  newClient.clear();
});

test('Home, overlapping trips and unit conversion reuse one canonical point', async () => {
  const cache = service();
  const trip = await cache.trip('trip');
  expect(tripWeatherUnit(trip, 'fahrenheit').days[0]?.temperatureMax).toBe(77);
  await cache.trip('other');
  await cache.location({ ...TOKYO, temperatureUnit: 'fahrenheit' });
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  expect(transport.location).not.toHaveBeenCalled();
  expect(trip.days[0]?.temperatureMax).toBe(25);
});

test('simultaneous consumers and two lease-fallback tabs acquire once', async () => {
  const a = service(),
    b = service();
  await Promise.all([a.trip('trip'), a.trip('other'), b.trip('trip')]);
  expect(transport.resolve).toHaveBeenCalledTimes(1);
});

test('Web Locks serialize overlapping requests and reread persisted evidence', async () => {
  const queues = new Map<string, Promise<unknown>>();
  const request = vi.fn(async (key: string, _options: unknown, work: () => Promise<unknown>) => {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  });
  vi.stubGlobal('navigator', { onLine: true, locks: { request } });
  await Promise.all([service().trip('trip'), service().trip('other')]);
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalled();
});

test('a closed-tab lease expires and another owner cannot release it', async () => {
  const key = weatherStorageKey('traveller', 'lease:point');
  expect(await claimWeatherLease(key, 'closed', Date.now() + 45_000)).toBe(true);
  await releaseWeatherLease(key, 'other');
  expect(await claimWeatherLease(key, 'other', Date.now() + 45_000)).toBe(false);
  await writeQueryCacheEntry(key, JSON.stringify({ owner: 'closed', expiresAt: Date.now() - 1 }));
  expect(await claimWeatherLease(key, 'other', Date.now() + 45_000)).toBe(true);
});

test('current expires at one hour while dated forecasts remain immediate during refresh', async () => {
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  let release!: (value: WeatherPointEvidence[]) => void;
  vi.mocked(transport.resolve).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const stale = await cache.trip('trip');
  await settled();
  expect(stale.current).toBeNull();
  expect(stale.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  release([evidence({ ...TOKYO, dates: ['2026-10-03'], current: true })]);
  await settled();
  expect((await cache.trip('trip')).current).not.toBeNull();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

test('upcoming forecast stays fresh until exactly six hours', async () => {
  mappings.set('trip', mapping(TOKYO, '2026-10-04'));
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.forecastMs - 1;
  await cache.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  now++;
  await cache.trip('trip');
  await settled();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

test('hidden and offline reads retain forecasts and suspend automatic acquisitions', async () => {
  const cache = service('traveller', true, () => online);
  let online = true;
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  vi.stubGlobal('document', { hidden: true });
  await cache.trip('trip');
  vi.stubGlobal('document', { hidden: false });
  online = false;
  await cache.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  online = true;
  await cache.trip('trip');
  await settled();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

test('outside-horizon dates make no point request until eligibility', async () => {
  mappings.set('trip', mapping(TOKYO, '2026-11-03'));
  const cache = service();
  const unavailable = await cache.trip('trip');
  await cache.trip('trip');
  expect(transport.resolve).not.toHaveBeenCalled();
  expect(unavailable.refreshAfter).toBeGreaterThan(now);
  now = Date.parse('2026-10-19T00:00:00Z');
  await cache.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
});

test('weather-relevant mappings change while fresh point evidence and unrelated edits survive', async () => {
  const cache = service();
  await cache.trip('trip');
  await cache.trip('other');
  await cache.syncMapping('trip', mapping(TOKYO, '2026-10-04'));
  mappings.set('trip', mapping(TOKYO, '2026-10-04'));
  expect((await cache.trip('trip')).days[0]?.date).toBe('2026-10-04');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  mappings.set('trip', mapping(OSAKA));
  await cache.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

test('metadata mappings persist and are fetched independently only when missing', async () => {
  await service('traveller', false).trip('trip');
  await service('traveller', false).trip('trip');
  expect(transport.locations).toHaveBeenCalledTimes(1);
  expect(transport.resolve).toHaveBeenCalledTimes(1);
});

test('failures share a five-minute cooldown and preserve original age', async () => {
  const cache = service();
  await cache.trip('trip');
  now += WEATHER_CACHE_POLICY.currentMs;
  vi.mocked(transport.resolve).mockRejectedValue(new Error('provider unavailable'));
  await cache.trip('trip');
  await settled();
  const stale = await service().trip('trip');
  expect(stale.days[0]?.fetchedAt).toBe(new Date(NOW).toISOString());
  expect(stale.current).toBeNull();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
  now += WEATHER_CACHE_POLICY.retryMs;
  await cache.trip('trip');
  await settled();
  expect(transport.resolve).toHaveBeenCalledTimes(3);
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

test('disabled persistence falls back to memory and sign-out prevents pending writes', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const cache = service();
  await cache.trip('trip');
  await cache.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  vi.stubGlobal('indexedDB', new FakeIndexedDbFactory());
  let release!: (value: WeatherPointEvidence[]) => void;
  vi.mocked(transport.resolve).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = service('old');
  const read = pending.trip('trip');
  await settled();
  pending.dispose();
  release([evidence({ ...TOKYO, dates: ['2026-10-03'], current: true })]);
  await read;
  expect(await createWeatherStorage('old').read(`point:${weatherLocationKey(TOKYO)}`)).toBeNull();
  await service('new').trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(3);
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

test('overlapping batches share their common point while acquiring only new locations', async () => {
  mappings.set('trip', {
    days: [
      { id: 'a', date: '2026-10-04', location: TOKYO },
      { id: 'b', date: '2026-10-05', location: OSAKA },
    ],
    fallback: TOKYO,
  });
  const sapporo = { ...TOKYO, latitude: 43.06, longitude: 141.35 };
  mappings.set('other', {
    days: [
      { id: 'c', date: '2026-10-04', location: TOKYO },
      { id: 'd', date: '2026-10-05', location: sapporo },
    ],
    fallback: TOKYO,
  });
  const a = service(),
    b = service();
  await Promise.all([a.trip('trip'), b.trip('other')]);
  const requested = vi.mocked(transport.resolve).mock.calls.flatMap(([points]) => points);
  expect(
    requested.filter((point) => weatherLocationKey(point) === weatherLocationKey(TOKYO)),
  ).toHaveLength(1);
  expect(requested).toHaveLength(3);
});

test('partial coverage is retained and missing dates are negatively cached', async () => {
  mappings.set('trip', mapping(TOKYO, '2026-10-05'));
  vi.mocked(transport.resolve).mockImplementation(async (points) =>
    points.map((point) => ({ ...evidence(point), days: [forecast('2026-10-04')] })),
  );
  const cache = service();
  expect((await cache.trip('trip')).days).toEqual([]);
  await cache.trip('trip');
  await service().trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(1);
  now += WEATHER_CACHE_POLICY.forecastMs;
  await cache.trip('trip');
  await settled();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

test('a forecast becomes active at local midnight and uses its shorter TTL', async () => {
  now = Date.parse('2026-10-03T14:59:00Z');
  mappings.set('trip', mapping(TOKYO, '2026-10-04'));
  const cache = service();
  await cache.trip('trip');
  const before = await cache.trip('trip');
  expect(before.refreshAfter).toBeLessThanOrEqual(Date.parse('2026-10-03T15:00:01Z'));
  now = Date.parse('2026-10-03T15:00:00Z');
  await cache.trip('trip');
  await settled();
  expect(vi.mocked(transport.resolve).mock.calls.at(-1)?.[0][0]?.current).toBe(true);
});

test('new source timestamps notify existing assessments, while local reuse and unit conversion do not', async () => {
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
  await cache.context('trip', 'en');
  expect(acquired).toHaveBeenCalledTimes(2);
  await cache.context('trip', 'en');
  expect(acquired).toHaveBeenCalledTimes(2);
});

test('completed acquisitions broadcast updates to another tab without a duplicate request', async () => {
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
  await vi.waitFor(() => expect(changed).toContain(`point:${weatherLocationKey(TOKYO)}`));
  await second.trip('trip');
  expect(transport.resolve).toHaveBeenCalledTimes(2);
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
