import {
  WEATHER_CACHE_POLICY,
  WEATHER_MAX_LOCATIONS,
  weatherCoordinate,
  weatherDailyTtl,
  weatherEvidenceFresh,
  weatherForecastWindow,
  weatherLocalDate,
  weatherLocationKey,
  weatherShiftDate,
  type TripContext,
  type TripContextClimate,
  type WeatherLocation,
  type WeatherLocations,
  type WeatherPointEvidence,
  type WeatherResolvePoint,
} from '@trove/types';
import type { LocationWeather, LocationWeatherRequest, TripWeather } from './api';
import {
  mergeArchivedTripWeather,
  restoreArchivedTripWeather,
  type ArchivedTripWeatherDay,
} from './history';
import type { WeatherStorage } from './storage';

type PointRecord = WeatherPointEvidence & {
  missing: Record<string, number>;
  currentRetryAt?: number;
};
type ContextRecord = Omit<TripContext, 'climate'> & {
  climate: { key: string; dayIds: string[] }[];
  checkedAt: number;
  retryAt?: number;
  mappingRevision?: number;
};
export interface WeatherTransport {
  locations(tripId: string, signal: AbortSignal): Promise<WeatherLocations>;
  resolve(
    points: readonly WeatherResolvePoint[],
    signal: AbortSignal,
  ): Promise<WeatherPointEvidence[]>;
  location(input: LocationWeatherRequest): Promise<LocationWeather>;
  context(tripId: string, language: string, signal: AbortSignal): Promise<TripContext>;
}
export type WeatherServiceOptions = {
  userId: string;
  storage: WeatherStorage;
  transport: WeatherTransport;
  lock<T>(keys: readonly string[], signal: AbortSignal, work: () => Promise<T>): Promise<T>;
  mapping?: (tripId: string) => Promise<WeatherLocations | null>;
  history?: {
    read(tripId: string): Promise<ArchivedTripWeatherDay[]>;
    write(tripId: string, days: ArchivedTripWeatherDay[]): Promise<void>;
  };
  now?: () => number;
  online?: () => boolean;
  onEvidence?: (tripIds: readonly string[]) => void;
};
const attribution = { label: 'Weather data by Open-Meteo.com', url: 'https://open-meteo.com/' };
function emptyPoint(location: WeatherLocation): PointRecord {
  return { location, days: [], current: null, hours: [], currentFetchedAt: null, missing: {} };
}
function canonical(location: WeatherLocation): WeatherLocation {
  return {
    ...location,
    latitude: weatherCoordinate(location.latitude),
    longitude: weatherCoordinate(location.longitude),
  };
}
function pointKey(point: WeatherLocation) {
  return `point:${weatherLocationKey(point)}`;
}
function validPoint(record: PointRecord | null, location: WeatherLocation): record is PointRecord {
  return Boolean(
    record &&
    record.location &&
    weatherLocationKey(record.location) === weatherLocationKey(location) &&
    Array.isArray(record.days) &&
    Array.isArray(record.hours) &&
    record.missing &&
    typeof record.missing === 'object' &&
    record.days.every(
      (day) =>
        typeof day.date === 'string' &&
        Number.isFinite(Date.parse(day.fetchedAt)) &&
        [day.temperatureMax, day.temperatureMin, day.weatherCode].every(Number.isFinite),
    ),
  );
}
function stamp(record: WeatherPointEvidence) {
  return JSON.stringify([
    record.currentFetchedAt,
    record.days.map((day) => [day.date, day.fetchedAt]).sort(),
  ]);
}
export function climateCacheKey(climate: TripContextClimate) {
  if (!climate.area || !climate.fetchedAt) return null;
  return `climate:open_meteo:${climate.area.latitude},${climate.area.longitude}:${climate.month}:${climate.years.from}:${climate.years.to}`;
}

/** The device's weather authority. Facade queries contain presentation, never a second disk cache. */
export class LocalWeatherService {
  private readonly memory = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly pendingRequests = new Map<string, WeatherResolvePoint>();
  private readonly listeners = new Set<(key: string) => void>();
  private readonly dependencies = new Map<string, Set<string>>();
  private readonly controller = new AbortController();
  private channel: BroadcastChannel | null = null;
  private active = true;
  constructor(private readonly options: WeatherServiceOptions) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private canRefresh() {
    return this.active && this.online() && (typeof document === 'undefined' || !document.hidden);
  }
  private online() {
    return this.options.online?.() ?? (typeof navigator === 'undefined' || navigator.onLine);
  }
  private remember(key: string, value: unknown) {
    this.memory.delete(key);
    this.memory.set(key, value);
    if (this.memory.size > 512) this.memory.delete(this.memory.keys().next().value!);
  }
  private async read<T>(key: string, force = false): Promise<T | null> {
    if (!force && this.memory.has(key)) return this.memory.get(key) as T;
    let stored: T | null = await this.options.storage.read<T>(key);
    if (force && key.startsWith('point:') && stored && this.memory.has(key)) {
      const disk = stored as unknown as PointRecord,
        local = this.memory.get(key) as PointRecord;
      if (Array.isArray(disk.days) && Array.isArray(local.days)) {
        const days = new Map(disk.days.map((day) => [day.date, day]));
        for (const day of local.days)
          if (
            !days.has(day.date) ||
            Date.parse(day.fetchedAt) > Date.parse(days.get(day.date)!.fetchedAt)
          )
            days.set(day.date, day);
        const live =
          Date.parse(local.currentFetchedAt ?? '') > Date.parse(disk.currentFetchedAt ?? '') ||
          (!disk.currentFetchedAt && local.currentFetchedAt)
            ? local
            : disk;
        stored = {
          ...disk,
          days: [...days.values()],
          current: live.current,
          hours: live.hours,
          currentFetchedAt: live.currentFetchedAt,
        } as T;
      }
    }
    if (stored !== null) this.remember(key, stored);
    return stored ?? (this.memory.get(key) as T) ?? null;
  }
  private async write(key: string, value: unknown) {
    if (!this.active) return;
    this.remember(key, value);
    await this.options.storage.write(key, value);
  }
  subscribe(listener: (key: string) => void) {
    this.listeners.add(listener);
    if (!this.channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`trove.weather:${this.options.userId}`);
      this.channel.onmessage = (event: MessageEvent<{ key?: string; acquired?: boolean }>) => {
        if (!this.active || typeof event.data?.key !== 'string') return;
        this.memory.delete(event.data.key);
        this.emit(event.data.key, Boolean(event.data.acquired), false);
      };
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(key: string, acquired = false, broadcast = true) {
    if (!this.active) return;
    for (const listener of this.listeners) listener(key);
    if (acquired)
      this.options.onEvidence?.(
        [...this.dependencies].filter(([, keys]) => keys.has(key)).map(([id]) => id),
      );
    if (broadcast) this.channel?.postMessage({ key, acquired });
  }
  dispose() {
    this.active = false;
    this.controller.abort();
    this.channel?.close();
    this.listeners.clear();
    this.memory.clear();
  }
  affects(queryKey: readonly unknown[], key: string) {
    const [root, id] = queryKey;
    if (root === 'trip-weather')
      return key === `mapping:${id}` || this.dependencies.get(String(id))?.has(key);
    if (root === 'trip-context')
      return key === `mapping:${id}` || key === `context:${id}:${queryKey[3]}`;
    if (root === 'location-weather') {
      const zone = String(queryKey[5]);
      const alias = `here:${id === null ? zone : `${Number(id)},${Number(queryKey[2])}`}:${zone}`;
      const location = (this.memory.get(alias) as { location?: WeatherLocation } | undefined)
        ?.location;
      return (
        key === alias ||
        (location
          ? key === pointKey(location)
          : id !== null &&
            key ===
              pointKey({ latitude: Number(id), longitude: Number(queryKey[2]), timeZone: zone }))
      );
    }
    return false;
  }
  private async contextRevision(tripId: string) {
    return (await this.read<number>(`context-revision:${tripId}`)) ?? 0;
  }
  private async invalidateContext(tripId: string) {
    await this.write(`context-revision:${tripId}`, (await this.contextRevision(tripId)) + 1);
  }
  async syncContextInput(tripId: string, scope: string, signature: string) {
    const key = `context-input:${tripId}:${scope}`,
      previous = await this.read<string>(key);
    if (previous === signature) return;
    await this.write(key, signature);
    if (previous !== null) {
      await this.invalidateContext(tripId);
      this.emit(`mapping:${tripId}`);
    }
  }
  async invalidateMapping(tripId: string) {
    const key = `mapping:${tripId}`;
    this.memory.delete(key);
    await this.options.storage.remove(key);
    await this.invalidateContext(tripId);
    this.emit(key);
  }
  async syncMapping(tripId: string, mapping: WeatherLocations) {
    const key = `mapping:${tripId}`;
    const previous = await this.read<WeatherLocations>(key);
    if (JSON.stringify(previous) === JSON.stringify(mapping)) return;
    await this.write(key, mapping);
    if (previous !== null) await this.invalidateContext(tripId);
    this.emit(key);
  }
  private async mapping(tripId: string) {
    const derived = await this.options.mapping?.(tripId);
    if (derived) {
      await this.syncMapping(tripId, derived);
      return derived;
    }
    const key = `mapping:${tripId}`;
    if (((await this.read<number>(`failure:${key}`)) ?? 0) > this.now())
      throw new Error('weather_unavailable');
    const local = await this.read<WeatherLocations>(key);
    if (local && Array.isArray(local.days)) return local;
    if (!this.canRefresh()) throw new Error('weather_unavailable');
    return this.options.lock([key], this.controller.signal, async () => {
      const restored = await this.read<WeatherLocations>(key, true);
      if (restored && Array.isArray(restored.days)) return restored;
      try {
        const acquired = await this.options.transport.locations(tripId, this.controller.signal);
        await this.write(key, acquired);
        return acquired;
      } catch (error) {
        await this.write(`failure:${key}`, this.now() + WEATHER_CACHE_POLICY.retryMs);
        throw error;
      }
    });
  }
  private async point(location: WeatherLocation, force = false) {
    const record = await this.read<PointRecord>(pointKey(location), force);
    if (!validPoint(record, location)) return emptyPoint(canonical(location));
    const now = this.now();
    return {
      ...record,
      days: record.days.filter(
        (day) =>
          Date.parse(day.fetchedAt) <= now &&
          now - Date.parse(day.fetchedAt) < WEATHER_CACHE_POLICY.seasonalMs,
      ),
    };
  }
  private needs(record: PointRecord, request: WeatherResolvePoint) {
    const now = this.now();
    if ((record.retryAt ?? 0) > now) return false;
    if (
      request.current &&
      (record.currentRetryAt ?? 0) <= now &&
      !weatherEvidenceFresh(record.currentFetchedAt ?? '', WEATHER_CACHE_POLICY.currentMs, now)
    )
      return true;
    return request.dates.some((date) => {
      if ((record.missing[date] ?? 0) > now) return false;
      const day = record.days.find((value) => value.date === date);
      return (
        !day ||
        !weatherEvidenceFresh(
          day.fetchedAt,
          weatherDailyTtl(date, request.timeZone, new Date(now)),
          now,
        )
      );
    });
  }
  private async refresh(
    requests: readonly WeatherResolvePoint[],
    loader?: () => Promise<WeatherPointEvidence[]>,
    followUp = true,
  ) {
    if (!this.canRefresh()) return;
    const claimed: WeatherResolvePoint[] = [];
    const waiting: Promise<void>[] = [];
    const owners = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>();
    for (const request of requests) {
      const key = pointKey(request);
      const pending = this.pending.get(key);
      if (pending) {
        const existing = this.pendingRequests.get(key);
        if (existing) {
          existing.current ||= request.current;
          existing.dates = [...new Set([...existing.dates, ...request.dates])];
        }
        waiting.push(pending);
        continue;
      }
      const promise = new Promise<void>((resolve, reject) => owners.set(key, { resolve, reject }));
      this.pending.set(key, promise);
      waiting.push(promise);
      const owned = { ...request, dates: [...request.dates] };
      this.pendingRequests.set(key, owned);
      claimed.push(owned);
      void promise
        .finally(() => {
          if (this.pending.get(key) === promise) {
            this.pending.delete(key);
            this.pendingRequests.delete(key);
          }
        })
        .catch(() => undefined);
    }
    if (claimed.length) {
      const work = this.options.lock(claimed.map(pointKey), this.controller.signal, async () => {
        const records = await Promise.all(claimed.map((point) => this.point(point, true)));
        const needed = claimed.filter((request, index) => this.needs(records[index]!, request));
        if (!needed.length) return;
        try {
          const answers = loader
            ? await loader()
            : await this.options.transport.resolve(needed, this.controller.signal);
          for (const request of needed) {
            const key = pointKey(request),
              old = await this.point(request);
            const answer = answers.find(
              (value) => weatherLocationKey(value.location) === weatherLocationKey(request),
            );
            const days = new Map(old.days.map((day) => [day.date, day]));
            for (const day of answer?.days ?? []) {
              if (
                Date.parse(day.fetchedAt) > this.now() ||
                !Number.isFinite(Date.parse(day.fetchedAt))
              )
                continue;
              if (
                !days.has(day.date) ||
                Date.parse(days.get(day.date)!.fetchedAt) <= Date.parse(day.fetchedAt)
              )
                days.set(day.date, day);
            }
            const next: PointRecord = {
              ...old,
              days: [...days.values()].filter(
                (day) => this.now() - Date.parse(day.fetchedAt) < WEATHER_CACHE_POLICY.seasonalMs,
              ),
              missing: { ...old.missing },
              retryAt: 0,
            };
            if (
              answer?.currentFetchedAt &&
              weatherEvidenceFresh(
                answer.currentFetchedAt,
                WEATHER_CACHE_POLICY.currentMs,
                this.now(),
              )
            ) {
              next.current = answer.current;
              next.hours = answer.hours;
              next.currentFetchedAt = answer.currentFetchedAt;
              next.currentRetryAt = 0;
            } else if (request.current)
              next.currentRetryAt = this.now() + WEATHER_CACHE_POLICY.retryMs;
            for (const date of request.dates) {
              const day = next.days.find((value) => value.date === date);
              next.missing[date] =
                day &&
                weatherEvidenceFresh(
                  day.fetchedAt,
                  weatherDailyTtl(date, request.timeZone, new Date(this.now())),
                  this.now(),
                )
                  ? 0
                  : this.now() +
                    (day
                      ? WEATHER_CACHE_POLICY.retryMs
                      : weatherDailyTtl(date, request.timeZone, new Date(this.now())));
            }
            await this.write(key, next);
            this.emit(key, stamp(old) !== stamp(next));
          }
        } catch (error) {
          if (!this.active) return;
          for (const request of needed) {
            const old = await this.point(request);
            await this.write(pointKey(request), {
              ...old,
              retryAt: this.now() + WEATHER_CACHE_POLICY.retryMs,
            });
            this.emit(pointKey(request));
          }
          // Cached dated evidence remains available. A cold failure still has a bounded retry deadline.
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      });
      void work.then(
        () => {
          for (const owner of owners.values()) owner.resolve();
        },
        (error) => {
          for (const owner of owners.values()) owner.reject(error);
        },
      );
    }
    await Promise.all(waiting);
    if (followUp && this.canRefresh()) {
      const records = await Promise.all(requests.map((request) => this.point(request)));
      const remaining = requests.filter((request, index) => this.needs(records[index]!, request));
      if (remaining.length) await this.refresh(remaining, loader, false);
    }
  }
  private async points(
    requests: readonly WeatherResolvePoint[],
    loader?: () => Promise<WeatherPointEvidence[]>,
  ) {
    const records = await Promise.all(requests.map((request) => this.point(request)));
    const stale = requests.filter((request, index) => this.needs(records[index]!, request));
    if (stale.length) {
      const refresh = this.refresh(stale, loader);
      if (records.some((record) => record.days.length || record.current))
        void refresh.catch(() => undefined);
      else await refresh;
    }
    return Promise.all(requests.map((request) => this.point(request)));
  }
  private deadline(record: PointRecord, request: WeatherResolvePoint) {
    const now = this.now();
    if ((record.retryAt ?? 0) > now) return record.retryAt!;
    const deadlines = request.dates.map((date) => {
      const day = record.days.find((value) => value.date === date);
      return (record.missing[date] ?? 0) > now
        ? record.missing[date]!
        : day
          ? Date.parse(day.fetchedAt) + weatherDailyTtl(date, request.timeZone, new Date(now))
          : now;
    });
    if (request.current)
      deadlines.push(
        (record.currentRetryAt ?? 0) > now
          ? record.currentRetryAt!
          : record.currentFetchedAt
            ? Date.parse(record.currentFetchedAt) + WEATHER_CACHE_POLICY.currentMs
            : now,
      );
    const deadline = Math.min(...deadlines, nextCalendarCheck(request.timeZone, now));
    return this.pending.has(pointKey(request)) ? Math.max(deadline, now + 30_000) : deadline;
  }
  async trip(tripId: string): Promise<TripWeather> {
    const mapping = await this.mapping(tripId),
      now = new Date(this.now());
    const window = weatherForecastWindow(
      mapping.days.flatMap((day) => (day.location ? [day.location.timeZone] : [])),
      now,
    );
    const groups = new Map<string, WeatherResolvePoint>();
    const located = mapping.days.filter(
      (day) => day.location && day.date >= window.startDate && day.date <= window.endDate,
    );
    if (located.length && mapping.fallback)
      groups.set(weatherLocationKey(mapping.fallback), {
        ...canonical(mapping.fallback),
        dates: [],
        current: false,
      });
    const selected = located.map((day) => {
      let location = canonical(day.location!);
      const key = weatherLocationKey(location);
      if (!groups.has(key) && groups.size >= WEATHER_MAX_LOCATIONS && mapping.fallback)
        location = canonical(mapping.fallback);
      const groupKey = weatherLocationKey(location);
      const group = groups.get(groupKey) ?? { ...location, dates: [], current: false };
      if (!group.dates.includes(day.date)) group.dates.push(day.date);
      if (day.date === weatherLocalDate(now, location.timeZone)) group.current = true;
      groups.set(groupKey, group);
      return { ...day, location };
    });
    const requests = [...groups.values()].filter((point) => point.dates.length);
    this.dependencies.set(
      tripId,
      new Set([
        ...[...(this.dependencies.get(tripId) ?? [])].filter((key) => key.startsWith('context:')),
        ...requests.map(pointKey),
      ]),
    );
    const records = await this.points(requests);
    const days = selected.flatMap((day) => {
      const record = records.find(
        (value) => weatherLocationKey(value.location) === weatherLocationKey(day.location),
      );
      const forecast = record?.days.find((value) => value.date === day.date);
      return forecast ? [{ ...forecast, itineraryDayId: day.id, location: day.location }] : [];
    });
    const live = selected.find((day) => day.date === weatherLocalDate(now, day.location.timeZone));
    const reading = live
      ? records.find(
          (value) => weatherLocationKey(value.location) === weatherLocationKey(live.location),
        )
      : undefined;
    let history: ArchivedTripWeatherDay[] = [];
    if (this.options.history) {
      try {
        history = await this.options.history.read(tripId);
        const merged = mergeArchivedTripWeather(history, days, 'celsius');
        if (this.active && JSON.stringify(merged) !== JSON.stringify(history))
          await this.options.history.write(tripId, merged);
        history = merged;
      } catch {
        /* A history failure must not hide current evidence. */
      }
    }
    const archived = restoreArchivedTripWeather(history, 'celsius')
      .filter((day) => day.date < window.startDate)
      .map((day) => ({ ...day, archived: true }));
    const deadlines = records.map((record, index) => this.deadline(record, requests[index]!));
    for (const day of mapping.days)
      if (day.location && day.date > window.endDate)
        deadlines.push(forecastEligibility(day.date, day.location.timeZone, this.now()));
    const currentFresh =
      reading?.currentFetchedAt &&
      weatherEvidenceFresh(reading.currentFetchedAt, WEATHER_CACHE_POLICY.currentMs, this.now());
    return {
      attribution,
      current: currentFresh ? reading.current : null,
      hours: currentFresh ? reading.hours : [],
      hoursDate: currentFresh ? (live?.date ?? null) : null,
      currentFetchedAt: reading?.currentFetchedAt ?? null,
      days: [...archived, ...days],
      fetchedAt: days.map((day) => day.fetchedAt).sort()[0] ?? reading?.currentFetchedAt ?? '',
      horizon: window,
      provider: 'open_meteo',
      temperatureUnit: 'celsius',
      refreshAfter: deadlines.length ? Math.min(...deadlines) : Number.POSITIVE_INFINITY,
    };
  }
  async location(input: LocationWeatherRequest): Promise<LocationWeather> {
    const aliasKey = `here:${input.latitude === undefined ? input.timeZone : `${weatherCoordinate(input.latitude)},${weatherCoordinate(input.longitude!)}`}:${input.timeZone}`;
    let alias = await this.read<{ location: WeatherLocation; place: LocationWeather['place'] }>(
      aliasKey,
    );
    const loader = async () => {
      const weather = await this.options.transport.location({
        ...input,
        temperatureUnit: 'celsius',
        signal: this.controller.signal,
      });
      alias = { location: canonical(weather.location), place: weather.place };
      await this.write(aliasKey, alias);
      return [
        {
          location: alias.location,
          days: weather.forecast.map((day) => ({
            ...day,
            fetchedAt: day.fetchedAt ?? weather.fetchedAt,
          })),
          current: weather.current,
          hours: weather.hours ?? [],
          currentFetchedAt: weather.fetchedAt,
        },
      ];
    };
    // Without coordinates, one initial zone-to-point resolution is unavoidable; subsequent reads use its local alias.
    if (!alias && input.latitude === undefined) {
      if (!this.canRefresh()) throw new Error('weather_unavailable');
      if (((await this.read<number>(`failure:${aliasKey}`)) ?? 0) > this.now())
        throw new Error('weather_unavailable');
      try {
        await this.options.lock([aliasKey], this.controller.signal, async () => {
          alias = await this.read<typeof alias>(aliasKey, true);
          if (alias) return;
          const evidence = (await loader())[0]!;
          await this.write(pointKey(evidence.location), { ...evidence, missing: {} });
          this.emit(pointKey(evidence.location), true);
        });
      } catch (error) {
        await this.write(`failure:${aliasKey}`, this.now() + WEATHER_CACHE_POLICY.retryMs);
        throw error;
      }
    }
    const location =
      alias?.location ??
      canonical({
        latitude: input.latitude!,
        longitude: input.longitude!,
        timeZone: input.timeZone,
      });
    const request = {
      ...location,
      dates: [weatherLocalDate(new Date(this.now()), location.timeZone)],
      current: true,
    };
    const record = (await this.points([request], loader))[0]!;
    const fresh =
      record.currentFetchedAt &&
      weatherEvidenceFresh(record.currentFetchedAt, WEATHER_CACHE_POLICY.currentMs, this.now());
    return {
      attribution,
      current: fresh ? record.current : null,
      forecast: record.days,
      location,
      hours: fresh ? record.hours : [],
      place: alias?.place ?? null,
      fetchedAt: record.currentFetchedAt ?? record.days[0]?.fetchedAt ?? '',
      currentFetchedAt: record.currentFetchedAt,
      refreshAfter: this.deadline(record, request),
    };
  }
  async context(tripId: string, language: string): Promise<TripContext & { refreshAfter: number }> {
    const key = `context:${tripId}:${language}`;
    let record = await this.read<ContextRecord>(key);
    const revision = await this.contextRevision(tripId);
    if (
      record &&
      (record.mappingRevision !== revision ||
        !Array.isArray(record.climate) ||
        !Array.isArray(record.days) ||
        !Array.isArray(record.holidays))
    )
      record = null;
    this.dependencies.set(tripId, new Set([...(this.dependencies.get(tripId) ?? []), key]));
    const compose = async (value: ContextRecord) => {
      const climate: TripContextClimate[] = [];
      let missing = false;
      for (const ref of value.climate) {
        const norm = await this.read<TripContextClimate>(ref.key);
        if (
          norm &&
          Number.isFinite(Date.parse(norm.fetchedAt ?? '')) &&
          Date.parse(norm.fetchedAt!) <= this.now() &&
          [norm.temperatureMaxC, norm.temperatureMinC, norm.wetDayShare].every(Number.isFinite)
        )
          climate.push({ ...norm, dayIds: ref.dayIds });
        else missing = true;
      }
      return {
        version: value.version,
        days: value.days,
        holidays: value.holidays,
        climate,
        refreshAfter:
          (value.retryAt ?? 0) > this.now()
            ? value.retryAt!
            : Math.min(
                missing || !value.climate.length
                  ? this.now()
                  : value.checkedAt + WEATHER_CACHE_POLICY.seasonalMs,
                ...climate.map((norm) =>
                  norm.years.to === new Date(this.now()).getUTCFullYear() - 1
                    ? Date.parse(norm.fetchedAt ?? '') + WEATHER_CACHE_POLICY.seasonalMs
                    : this.now(),
                ),
              ),
      };
    };
    const data = record ? await compose(record) : null;
    if ((!data || data.refreshAfter <= this.now()) && this.canRefresh()) {
      const refresh = this.options.lock([key], this.controller.signal, async () => {
        const restored = await this.read<ContextRecord>(key, true);
        if (
          restored &&
          restored.mappingRevision === revision &&
          (await compose(restored)).refreshAfter > this.now()
        ) {
          record = restored;
          return;
        }
        try {
          const acquired = await this.options.transport.context(
            tripId,
            language,
            this.controller.signal,
          );
          const references: ContextRecord['climate'] = [];
          let changed = false;
          for (const norm of acquired.climate) {
            const cellKey = climateCacheKey(norm);
            if (!cellKey) continue;
            const previous = await this.read<TripContextClimate>(cellKey);
            changed ||= previous?.fetchedAt !== norm.fetchedAt;
            await this.write(cellKey, { ...norm, dayIds: [] });
            references.push({ key: cellKey, dayIds: norm.dayIds });
          }
          // An unavailable refresh retains the same dated seasonal evidence for unchanged mappings.
          if (!references.length && restored?.mappingRevision === revision)
            references.push(...restored.climate);
          record = {
            version: acquired.version,
            days: acquired.days,
            holidays: acquired.holidays,
            climate: references,
            checkedAt: this.now(),
            mappingRevision: revision,
            retryAt:
              acquired.climate.length &&
              acquired.climate.every(
                (norm) =>
                  norm.fetchedAt &&
                  weatherEvidenceFresh(norm.fetchedAt, WEATHER_CACHE_POLICY.seasonalMs, this.now()),
              )
                ? 0
                : this.now() + WEATHER_CACHE_POLICY.retryMs,
          };
          this.dependencies.set(tripId, new Set([...(this.dependencies.get(tripId) ?? []), key]));
          await this.write(key, record);
          this.emit(key, changed);
        } catch {
          if (this.active) {
            record = record
              ? { ...record, retryAt: this.now() + WEATHER_CACHE_POLICY.retryMs }
              : {
                  version: 2,
                  days: [],
                  holidays: [],
                  climate: [],
                  checkedAt: 0,
                  mappingRevision: revision,
                  retryAt: this.now() + WEATHER_CACHE_POLICY.retryMs,
                };
            await this.write(key, record);
            this.emit(key);
          }
        }
      });
      if (data) void refresh.catch(() => undefined);
      else await refresh;
    }
    if (!record) throw new Error('weather_unavailable');
    return compose(record);
  }
}

function nextCalendarCheck(zone: string, now: number) {
  const date = weatherLocalDate(new Date(now), zone);
  // Bounded search handles DST and the UTC guard without assuming every local day is 24 hours.
  let low = now,
    high = now + 26 * 60 * 60 * 1_000;
  while (high - low > 1_000) {
    const mid = Math.floor((low + high) / 2);
    if (weatherLocalDate(new Date(mid), zone) === date) low = mid;
    else high = mid;
  }
  return Math.min(
    high,
    Date.parse(`${weatherShiftDate(weatherLocalDate(new Date(now), 'UTC'), 1)}T00:00:00Z`),
  );
}
function forecastEligibility(date: string, zone: string, now: number) {
  const threshold = weatherShiftDate(date, -15);
  let low = now,
    high = Date.parse(`${weatherShiftDate(threshold, 2)}T00:00:00Z`);
  while (high - low > 1_000) {
    const mid = Math.floor((low + high) / 2);
    if (weatherForecastWindow([zone], new Date(mid)).endDate >= date) high = mid;
    else low = mid;
  }
  return high;
}
