import { getPrismaClient } from '@trove/db';
import { WEATHER_CACHE_POLICY } from '@trove/types';
import {
  recordProviderCacheEvent,
  recordProviderCall,
  type ProviderCallSource,
} from './provider-usage.js';
import { OpenMeteoWeatherProvider, type WeatherPoint, type WeatherProvider } from './weather.js';
import type { ForecastWindow } from './weather-window.js';
import { waitForLiveWeather } from './weather-context-cache.js';
import { weatherMemory, weatherFailureKey } from './weather-memory.js';
import {
  readCachedForecastBatch,
  weatherPointKey,
  writeForecastSnapshot,
  forecastIsFresh,
  type CachedPointForecast,
} from './weather-evidence-cache.js';
export type { CachedPointForecast } from './weather-evidence-cache.js';
export { WEATHER_FORECAST_TTL_MS, weatherPointKey } from './weather-evidence-cache.js';

const pendingByClient = new WeakMap<object, Map<string, Promise<CachedPointForecast | null>>>();
/** Point-level ownership prevents overlapping batches from acquiring the same point twice. */
export class CachedWeatherService {
  constructor(
    private readonly provider: WeatherProvider = new OpenMeteoWeatherProvider(),
    private readonly now: () => Date = () => new Date(),
    private readonly source: ProviderCallSource = 'weather',
  ) {}

  async getForecasts(
    points: readonly WeatherPoint[],
    window: ForecastWindow,
    required?: ReadonlyMap<string, ForecastWindow>,
    followUp = true,
  ): Promise<Map<string, CachedPointForecast>> {
    const owner = getPrismaClient();
    let pending = pendingByClient.get(owner);
    if (!pending) pendingByClient.set(owner, (pending = new Map()));
    const unique = [...new Map(points.map((point) => [weatherPointKey(point), point])).values()];
    const claimed: WeatherPoint[] = [];
    const joined = new Set<string>();
    const settlers = new Map<
      string,
      { resolve: (value: CachedPointForecast | null) => void; reject: (error: unknown) => void }
    >();
    const promises = unique.map((point) => {
      const key = weatherPointKey(point);
      const existing = pending!.get(key);
      if (existing) {
        joined.add(key);
        return existing;
      }
      const promise = new Promise<CachedPointForecast | null>((resolve, reject) =>
        settlers.set(key, { resolve, reject }),
      );
      pending!.set(key, promise);
      claimed.push(point);
      void promise
        .finally(() => {
          if (pending!.get(key) === promise) pending!.delete(key);
        })
        .catch(() => undefined);
      return promise;
    });
    if (claimed.length)
      void this.acquire(claimed, window, required).then(
        (answers) => {
          for (const point of claimed)
            settlers
              .get(weatherPointKey(point))!
              .resolve(answers.get(weatherPointKey(point)) ?? null);
        },
        (error) => {
          for (const point of claimed) settlers.get(weatherPointKey(point))!.reject(error);
        },
      );
    const results = await Promise.all(promises);
    if (followUp) {
      const missing = unique.filter(
        (point, index) =>
          joined.has(weatherPointKey(point)) &&
          results[index] &&
          !forecastIsFresh(
            results[index]!,
            required?.get(weatherPointKey(point)) ?? window,
            this.now(),
          ) &&
          !(
            (weatherMemory().get<{ retryAt: number }>(`daily-failure:${weatherPointKey(point)}`)
              ?.retryAt ?? 0) > this.now().getTime()
          ),
      );
      if (missing.length) {
        const refreshed = await this.getForecasts(missing, window, required, false);
        for (const [index, point] of unique.entries())
          if (refreshed.has(weatherPointKey(point)))
            results[index] = refreshed.get(weatherPointKey(point))!;
      }
    }
    return new Map(
      results.flatMap((forecast, index) =>
        forecast ? [[weatherPointKey(unique[index]!), forecast] as const] : [],
      ),
    );
  }

  private async acquire(
    points: readonly WeatherPoint[],
    window: ForecastWindow,
    required?: ReadonlyMap<string, ForecastWindow>,
  ) {
    const answers = new Map<string, CachedPointForecast>();
    const memory = weatherMemory();
    const cooling = points.filter((point) => {
      const failure = memory.get<{ retryAt: number; error: unknown }>(
        `daily-failure:${weatherPointKey(point)}`,
      );
      if (!failure || failure.retryAt <= this.now().getTime()) return false;
      const stored = memory.get<CachedPointForecast>(`daily:${weatherPointKey(point)}`);
      if (stored) answers.set(weatherPointKey(point), stored);
      else throw failure.error;
      return true;
    });
    const remaining = points.filter((point) => !cooling.includes(point));
    await waitForLiveWeather(remaining);
    const cached = await readCachedForecastBatch(remaining, window, this.now(), required);
    let stale: WeatherPoint[] = [];
    for (const point of remaining) {
      const result = cached.get(weatherPointKey(point))!;
      if (result.kind === 'hit') {
        recordProviderCacheEvent({
          cache: 'weather-forecast',
          kind: 'cache_hit',
          operation: 'getForecast',
          provider: 'open_meteo',
          source: this.source,
        });
        answers.set(weatherPointKey(point), result.forecast);
      } else {
        const failure = memory.get<{ retryAt: number; error: unknown }>(weatherFailureKey(point));
        if (failure && failure.retryAt > this.now().getTime()) {
          memory.set(`daily-failure:${weatherPointKey(point)}`, failure);
          if (result.stored) answers.set(weatherPointKey(point), result.stored);
          else throw failure.error;
        } else stale.push(point);
      }
    }
    if (stale.length && (await waitForLiveWeather(stale))) {
      const seeded = await readCachedForecastBatch(stale, window, this.now(), required);
      stale = stale.filter((point) => {
        const result = seeded.get(weatherPointKey(point))!;
        if (result.kind !== 'hit') return true;
        answers.set(weatherPointKey(point), result.forecast);
        return false;
      });
    }
    if (!stale.length) return answers;
    try {
      recordProviderCall({
        endpoint: '/v1/forecast',
        expectedSku: 'weather-forecast-free',
        operation: 'getForecast',
        provider: 'open_meteo',
        source: this.source,
      });
      const acquired = await this.provider.getDailyForecasts({ points: stale, ...window });
      const fetchedAt = this.now();
      for (const forecast of acquired) {
        const result = { ...forecast, fetchedAt };
        await writeForecastSnapshot(result);
        answers.set(weatherPointKey(forecast.point), result);
      }
    } catch (error) {
      for (const point of stale) {
        const key = weatherPointKey(point);
        const failed = { error, retryAt: this.now().getTime() + WEATHER_CACHE_POLICY.retryMs };
        memory.set(`daily-failure:${key}`, failed);
        memory.set(weatherFailureKey(point), failed);
        const result = cached.get(key)!;
        if (result.kind === 'miss' && result.stored) answers.set(key, result.stored);
      }
      if (!answers.size) throw error;
    }
    return answers;
  }
}
