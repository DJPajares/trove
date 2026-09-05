const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 200;

export const WEATHER_ATTRIBUTION = {
  label: 'Weather data by Open-Meteo.com',
  url: 'https://open-meteo.com/',
} as const;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OpenMeteoResponse = {
  current?: {
    apparent_temperature?: unknown;
    is_day?: unknown;
    temperature_2m?: unknown;
    time?: unknown;
    weather_code?: unknown;
  };
  daily?: {
    precipitation_probability_max?: unknown[];
    temperature_2m_max?: unknown[];
    temperature_2m_min?: unknown[];
    time?: unknown[];
    weather_code?: unknown[];
  };
  /** Present only on the second and later entries of a multi-point answer. */
  location_id?: unknown;
  timezone?: unknown;
};

export type TemperatureUnit = 'celsius' | 'fahrenheit';

export type WeatherRequest = {
  latitude: number;
  longitude: number;
  temperatureUnit: TemperatureUnit;
  timeZone: string;
};

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

/** One coordinate the daily forecast is asked about. */
export type WeatherPoint = {
  latitude: number;
  longitude: number;
};

/**
 * One point's answer. Temperatures are celsius: the wire format is fixed so a
 * traveller's unit preference never becomes part of a cache key.
 */
export type WeatherPointForecast = {
  days: WeatherDailyForecast[];
  location: {
    latitude: number;
    longitude: number;
    timeZone: string;
  };
  point: WeatherPoint;
};

export type WeatherDailyForecastRequest = {
  endDate: string;
  points: readonly WeatherPoint[];
  startDate: string;
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

/**
 * The provider's own account of a rejection, if it gave one.
 *
 * Reading the body can itself fail - a truncated response, a gateway's HTML -
 * and a diagnostic that throws is worse than one that says nothing, so every
 * failure here is simply no reason.
 */
async function readProviderReason(response: Response) {
  try {
    const body = (await response.json()) as { reason?: unknown };
    return typeof body.reason === 'string' ? body.reason : null;
  } catch {
    return null;
  }
}

export type WeatherProviderErrorCode =
  'invalid_request' | 'invalid_response' | 'provider_unavailable';

export class WeatherProviderError extends Error {
  constructor(
    public readonly code: WeatherProviderErrorCode,
    options?: ErrorOptions & {
      /**
       * What the provider said, when it said anything. Open-Meteo answers a
       * rejection with its own explanation - the allowed date range, a
       * coordinate out of bounds - and dropping it is what turned this into a
       * 400 with no cause in the logs.
       */
      reason?: string | null;
    },
  ) {
    super(code, options);
    this.name = 'WeatherProviderError';
    this.reason = options?.reason ?? null;
  }

  public readonly reason: string | null;
}

export interface WeatherProvider {
  getDailyForecasts(input: WeatherDailyForecastRequest): Promise<WeatherPointForecast[]>;
  getWeather(input: WeatherRequest): Promise<Omit<WeatherContext, 'fetchedAt'>>;
}

type OpenMeteoWeatherProviderOptions = {
  baseUrl?: string;
  fetcher?: Fetcher;
  requestTimeoutMs?: number;
};

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isWeatherCode(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 99;
}

function mapCurrent(current: OpenMeteoResponse['current']): WeatherCurrentConditions | null {
  if (!current) return null;
  if (
    !isDateTime(current.time) ||
    !isFiniteNumber(current.temperature_2m) ||
    !isFiniteNumber(current.apparent_temperature) ||
    !isWeatherCode(current.weather_code) ||
    (current.is_day !== 0 && current.is_day !== 1)
  ) {
    throw new WeatherProviderError('invalid_response');
  }

  return {
    apparentTemperature: current.apparent_temperature,
    isDay: current.is_day === 1,
    observedAt: current.time,
    temperature: current.temperature_2m,
    weatherCode: current.weather_code,
  };
}

function mapForecast(daily: OpenMeteoResponse['daily']): WeatherDailyForecast[] {
  if (
    !daily ||
    !Array.isArray(daily.time) ||
    !Array.isArray(daily.temperature_2m_max) ||
    !Array.isArray(daily.temperature_2m_min) ||
    !Array.isArray(daily.weather_code) ||
    !Array.isArray(daily.precipitation_probability_max) ||
    daily.time.length !== daily.temperature_2m_max.length ||
    daily.time.length !== daily.temperature_2m_min.length ||
    daily.time.length !== daily.weather_code.length ||
    daily.time.length !== daily.precipitation_probability_max.length
  ) {
    throw new WeatherProviderError('invalid_response');
  }

  const forecast = daily.time.map((date, index) => {
    const maximum = daily.temperature_2m_max?.[index];
    const minimum = daily.temperature_2m_min?.[index];
    const precipitation = daily.precipitation_probability_max?.[index];
    const weatherCode = daily.weather_code?.[index];
    if (
      !isDate(date) ||
      !isFiniteNumber(maximum) ||
      !isFiniteNumber(minimum) ||
      !isWeatherCode(weatherCode) ||
      (precipitation !== null && precipitation !== undefined && !isFiniteNumber(precipitation))
    ) {
      throw new WeatherProviderError('invalid_response');
    }
    return {
      date,
      precipitationProbability: isFiniteNumber(precipitation) ? precipitation : null,
      temperatureMax: maximum,
      temperatureMin: minimum,
      weatherCode,
    };
  });

  if (!forecast.length) throw new WeatherProviderError('invalid_response');
  return forecast;
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMs: number;

  constructor(options: OpenMeteoWeatherProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Every point's daily forecast in one request.
   *
   * Open-Meteo takes comma-separated coordinates and answers with an array, so
   * a trip crossing four cities costs the same single call as a trip that never
   * leaves one. `start_date`/`end_date` apply to every point in the batch, and a
   * date outside the served window is a hard 400 rather than a short answer -
   * see `resolveForecastWindow`, which is what keeps this call legal.
   */
  async getDailyForecasts(input: WeatherDailyForecastRequest): Promise<WeatherPointForecast[]> {
    if (!input.points.length) return [];

    const url = new URL(this.baseUrl);
    url.search = new URLSearchParams({
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      end_date: input.endDate,
      latitude: input.points.map((point) => String(point.latitude)).join(','),
      longitude: input.points.map((point) => String(point.longitude)).join(','),
      start_date: input.startDate,
      temperature_unit: 'celsius',
      timezone: 'auto',
    }).toString();

    const payload = await this.requestJson<OpenMeteoResponse | OpenMeteoResponse[]>(url);
    // A single coordinate answers with an object; several answer with an array.
    const entries = Array.isArray(payload) ? payload : [payload];
    if (entries.length !== input.points.length) throw new WeatherProviderError('invalid_response');

    return entries.map((entry, index) => {
      // The first entry carries no `location_id`; later ones number themselves
      // by request position. Trusting the index alone would silently hand one
      // city's forecast to another if that ever changed.
      const locationId = isFiniteNumber(entry.location_id) ? entry.location_id : 0;
      const point = input.points[locationId];
      if (!point || locationId !== index) throw new WeatherProviderError('invalid_response');

      const timeZone = typeof entry.timezone === 'string' && entry.timezone ? entry.timezone : null;
      if (!timeZone) throw new WeatherProviderError('invalid_response');

      return {
        days: mapForecast(entry.daily),
        location: { latitude: point.latitude, longitude: point.longitude, timeZone },
        point,
      };
    });
  }

  async getWeather(input: WeatherRequest): Promise<Omit<WeatherContext, 'fetchedAt'>> {
    const url = new URL(this.baseUrl);
    url.search = new URLSearchParams({
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      forecast_days: '16',
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      temperature_unit: input.temperatureUnit,
      timezone: input.timeZone,
    }).toString();

    const payload = await this.requestJson<OpenMeteoResponse>(url);

    const timeZone =
      typeof payload.timezone === 'string' && payload.timezone ? payload.timezone : null;
    if (!timeZone) throw new WeatherProviderError('invalid_response');

    return {
      attribution: WEATHER_ATTRIBUTION,
      current: mapCurrent(payload.current),
      forecast: mapForecast(payload.daily),
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        timeZone,
      },
      provider: 'open_meteo',
      temperatureUnit: input.temperatureUnit,
    };
  }

  private async requestJson<T>(url: URL): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new WeatherProviderError('provider_unavailable', { cause: error });
    }

    if (!response.ok) {
      throw new WeatherProviderError(
        response.status === 400 || response.status === 422
          ? 'invalid_request'
          : 'provider_unavailable',
        { reason: await readProviderReason(response) },
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new WeatherProviderError('invalid_response', { cause: error });
    }
  }
}

type CacheEntry = {
  expiresAt: number;
  value: WeatherContext;
};

export class WeatherService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly provider: WeatherProvider = new OpenMeteoWeatherProvider(),
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  async getWeather(input: WeatherRequest) {
    const key = [
      input.latitude.toFixed(3),
      input.longitude.toFixed(3),
      input.timeZone,
      input.temperatureUnit,
    ].join(':');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result: WeatherContext = {
      ...(await this.provider.getWeather(input)),
      fetchedAt: new Date().toISOString(),
    };
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, value: result });
    this.pruneCache();
    return result;
  }

  private pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) return;
      this.cache.delete(oldestKey);
    }
  }
}
