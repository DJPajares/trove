import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import type { TemperatureUnit } from '@/lib/profile/preferences';

export type WeatherCurrentConditions = {
  apparentTemperature: number;
  isDay: boolean;
  observedAt: string;
  temperature: number;
  weatherCode: number;
};

export type WeatherDailyForecast = {
  date: string;
  precipitationProbability: number | null;
  temperatureMax: number;
  temperatureMin: number;
  weatherCode: number;
};

export type WeatherContext = {
  attribution: {
    label: string;
    url: string;
  };
  current: WeatherCurrentConditions | null;
  forecast: WeatherDailyForecast[];
  fetchedAt: string;
  location: {
    latitude: number;
    longitude: number;
    timeZone: string;
  };
  provider: 'open_meteo';
  temperatureUnit: TemperatureUnit;
};

export type CachedWeatherContext = WeatherContext & {
  source: 'cache' | 'live';
  stale: boolean;
};

export type WeatherRequest = {
  latitude: number;
  longitude: number;
  signal?: AbortSignal;
  temperatureUnit: TemperatureUnit;
  timeZone: string;
};

export class WeatherApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';
const CACHE_MAX_AGE_MS = 6 * 60 * 60_000;
const OFFLINE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const cachePrefix = 'trove:weather:v1:';

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new WeatherApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new WeatherApiError('not_authenticated', 401);
  return data.session.access_token;
}

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function cacheKey(input: Omit<WeatherRequest, 'signal'>) {
  return [
    cachePrefix,
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
    input.timeZone,
    input.temperatureUnit,
  ].join(':');
}

function readCache(key: string, allowStale: boolean) {
  if (!hasStorage()) return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    if (!isWeatherContext(value)) return null;
    const fetchedAt = new Date(value.fetchedAt).getTime();
    const age = Date.now() - fetchedAt;
    if (!Number.isFinite(fetchedAt) || age > OFFLINE_CACHE_MAX_AGE_MS) return null;
    if (!allowStale && age > CACHE_MAX_AGE_MS) return null;
    return { ...value, source: 'cache' as const, stale: age > CACHE_MAX_AGE_MS };
  } catch {
    return null;
  }
}

function writeCache(key: string, value: WeatherContext) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private browser session or full storage should not block Trip Mode.
  }
}

function isWeatherContext(value: unknown): value is WeatherContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WeatherContext>;
  return (
    candidate.provider === 'open_meteo' &&
    (candidate.temperatureUnit === 'celsius' || candidate.temperatureUnit === 'fahrenheit') &&
    typeof candidate.fetchedAt === 'string' &&
    Array.isArray(candidate.forecast) &&
    Boolean(candidate.attribution?.label) &&
    Boolean(candidate.attribution?.url) &&
    typeof candidate.location?.latitude === 'number' &&
    typeof candidate.location?.longitude === 'number' &&
    typeof candidate.location?.timeZone === 'string'
  );
}

async function weatherRequest<T>(path: string, signal?: AbortSignal) {
  const accessToken = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new WeatherApiError('weather_unavailable', 503);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new WeatherApiError(
      body.code ?? `weather_request_failed_${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export async function getWeather(input: WeatherRequest): Promise<CachedWeatherContext> {
  const { signal, ...request } = input;
  const key = cacheKey(request);
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const cached = readCache(key, offline);
  if (offline) {
    if (cached) return cached;
    throw new WeatherApiError('weather_unavailable', 503);
  }

  const query = new URLSearchParams({
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    temperatureUnit: request.temperatureUnit,
    timeZone: request.timeZone,
  });
  try {
    const weather = await weatherRequest<WeatherContext>(`/weather?${query.toString()}`, signal);
    writeCache(key, weather);
    return { ...weather, source: 'live', stale: false };
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}
