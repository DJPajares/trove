/** Shared acquisition policy. Reuse never changes the source timestamp. */
export const WEATHER_CACHE_POLICY = {
  currentMs: 60 * 60 * 1_000,
  forecastMs: 6 * 60 * 60 * 1_000,
  seasonalMs: 30 * 24 * 60 * 60 * 1_000,
  retryMs: 5 * 60 * 1_000,
  leaseMs: 45 * 1_000,
} as const;
/** Compatibility alias for current/hourly consumers. */
export const WEATHER_CACHE_TTL_MS = WEATHER_CACHE_POLICY.currentMs;
export const WEATHER_FORECAST_HORIZON_DAYS = 15;
export const WEATHER_MAX_LOCATIONS = 10;

export type WeatherLocation = { latitude: number; longitude: number; timeZone: string };
export type WeatherDaily = {
  date: string;
  precipitationProbability: number | null;
  temperatureMax: number;
  temperatureMin: number;
  weatherCode: number;
};
export type WeatherCurrent = {
  apparentTemperature: number;
  isDay: boolean;
  observedAt: string;
  temperature: number;
  weatherCode: number;
};
export type WeatherHour = {
  precipitationProbability: number | null;
  temperature: number;
  time: string;
  weatherCode: number;
};
export type WeatherResolvePoint = WeatherLocation & { dates: string[]; current?: boolean };
export type WeatherPointEvidence = {
  location: WeatherLocation;
  days: (WeatherDaily & { fetchedAt: string })[];
  current: WeatherCurrent | null;
  hours: WeatherHour[];
  currentFetchedAt: string | null;
  retryAt?: number;
};
export type WeatherLocations = {
  days: { id: string; date: string; location: WeatherLocation | null }[];
  fallback: WeatherLocation | null;
};

export function weatherCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}
export function weatherLocationKey(location: WeatherLocation) {
  return `open_meteo:${weatherCoordinate(location.latitude)},${weatherCoordinate(location.longitude)}:${location.timeZone}`;
}
export function weatherLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function weatherShiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weatherForecastWindow(timeZones: readonly string[], now = new Date()) {
  const today = (timeZones.length ? timeZones : ['UTC'])
    .map((zone) => weatherLocalDate(now, zone))
    .sort()[0]!;
  const endDate = [
    weatherShiftDate(today, WEATHER_FORECAST_HORIZON_DAYS),
    weatherShiftDate(weatherLocalDate(now, 'UTC'), WEATHER_FORECAST_HORIZON_DAYS),
  ].sort()[0]!;
  return { startDate: today, endDate };
}
export function weatherDailyTtl(date: string, timeZone: string, now = new Date()) {
  return date === weatherLocalDate(now, timeZone)
    ? WEATHER_CACHE_POLICY.currentMs
    : WEATHER_CACHE_POLICY.forecastMs;
}
export function weatherEvidenceFresh(fetchedAt: string | number, ttl: number, now = Date.now()) {
  const instant = typeof fetchedAt === 'number' ? fetchedAt : Date.parse(fetchedAt);
  return Number.isFinite(instant) && instant <= now && now - instant < ttl;
}
/** Shared nearest-day fallback; a preceding day wins ties. */
export function weatherDayLocations(
  own: readonly (WeatherLocation | null)[],
  destination: WeatherLocation | null,
) {
  return own.map((location, index) => {
    if (location || destination) return location ?? destination;
    for (let distance = 1; distance < own.length; distance++) {
      const nearest = own[index - distance] ?? own[index + distance];
      if (nearest) return nearest;
    }
    return null;
  });
}
