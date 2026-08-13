const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 200;

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

export type WeatherProviderErrorCode =
  'invalid_request' | 'invalid_response' | 'provider_unavailable';

export class WeatherProviderError extends Error {
  constructor(
    public readonly code: WeatherProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'WeatherProviderError';
  }
}

export interface WeatherProvider {
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
      );
    }

    let payload: OpenMeteoResponse;
    try {
      payload = (await response.json()) as OpenMeteoResponse;
    } catch (error) {
      throw new WeatherProviderError('invalid_response', { cause: error });
    }

    const timeZone =
      typeof payload.timezone === 'string' && payload.timezone ? payload.timezone : null;
    if (!timeZone) throw new WeatherProviderError('invalid_response');

    return {
      attribution: {
        label: 'Weather data by Open-Meteo.com',
        url: 'https://open-meteo.com/',
      },
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
