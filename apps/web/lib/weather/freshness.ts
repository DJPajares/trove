import { localDateInTimeZone, localPreviewInstant } from '@/lib/itinerary/api';
import { selectHourlyReadings } from '@/lib/weather/hourly';
import { WEATHER_CACHE_TTL_MS } from '@trove/types';

import type { LocationWeather, TripWeather, TripWeatherDay } from '@/lib/weather/api';

export const WEATHER_CURRENT_MAX_AGE_MS = WEATHER_CACHE_TTL_MS;

function localMinute(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

/** Provider observations are wall clocks in the evidence zone, not the device zone. */
export function observationInstant(
  observedAt: string | null | undefined,
  timeZone: string | null | undefined,
) {
  if (!observedAt || !timeZone) return null;
  try {
    // Accept explicit instants too, without letting Date.parse normalize bad dates.
    const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
        observedAt,
      );
    if (!match) return null;
    const wall = match[1]!;
    const wallMs = Date.parse(`${wall}:00Z`);
    if (!Number.isFinite(wallMs) || new Date(wallMs).toISOString().slice(0, 16) !== wall)
      return null;
    // Validate the zone even if the timestamp carries its own offset.
    localMinute(new Date(wallMs), timeZone);
    if (match[2]) {
      const instant = Date.parse(observedAt);
      return Number.isFinite(instant) ? instant : null;
    }
    if (observedAt !== wall) return null;

    const initial = localPreviewInstant(wall.slice(0, 10), wall.slice(11), timeZone).getTime();
    const candidates = new Set<number>();
    // Offsets on either side of a transition expose both occurrences of a
    // repeated wall clock, including half-hour DST. A gap has no match.
    for (const shift of [-86_400_000, 0, 86_400_000]) {
      const sample = initial + shift;
      const offset = Date.parse(`${localMinute(new Date(sample), timeZone)}:00Z`) - sample;
      const candidate = wallMs - offset;
      if (localMinute(new Date(candidate), timeZone) === wall) candidates.add(candidate);
    }
    return candidates.size === 1 ? [...candidates][0]! : null;
  } catch {
    return null;
  }
}

export function isCurrentReadingStale(
  observedAt: string | null | undefined,
  timeZone: string | null | undefined,
  now = new Date(),
) {
  const instant = observationInstant(observedAt, timeZone);
  const age = instant === null ? NaN : now.getTime() - instant;
  return !Number.isFinite(age) || age < 0 || age > WEATHER_CURRENT_MAX_AGE_MS;
}

export function forecastRetrievalInstant(fetchedAt: string | null | undefined) {
  if (!fetchedAt || !/(Z|[+-]\d{2}:\d{2})$/.test(fetchedAt)) return null;
  const instant = Date.parse(fetchedAt);
  return Number.isFinite(instant) ? new Date(instant) : null;
}

export function isArchivedForecast(day: TripWeatherDay, now = new Date()) {
  if (day.archived) return true;
  try {
    return day.date < localDateInTimeZone(day.location.timeZone, now);
  } catch {
    return false;
  }
}

export function forecastForDate(weather: TripWeather | null, date: string) {
  const day = weather?.days.find((candidate) => candidate.date === date);
  if (!day || !weather) return null;
  // Legacy query payloads have an envelope timestamp, but their restored past
  // archives never carried a retrieval time. Do not assign today's age to them.
  if (day.fetchedAt === undefined && !day.archived && date >= weather.horizon.startDate) {
    return { ...day, fetchedAt: weather.fetchedAt };
  }
  return day;
}

/** Selection is independent of query status/receipt age and never discards daily evidence. */
export function selectTripWeather(
  weather: TripWeather,
  selectedDate: string,
  isPreview: boolean,
  now = new Date(),
) {
  const forecast = forecastForDate(weather, selectedDate);
  const observationDay = weather.days.find((day) => day.date === weather.hoursDate);
  const timeZone = observationDay?.location.timeZone;
  let isToday = false;
  try {
    isToday = Boolean(timeZone && selectedDate === localDateInTimeZone(timeZone, now));
  } catch {
    /* Unknown zones cannot support a current claim. */
  }
  const current =
    !isPreview &&
    isToday &&
    !observationDay?.archived &&
    weather.hoursDate === selectedDate &&
    !isCurrentReadingStale(weather.current?.observedAt, timeZone, now)
      ? weather.current
      : null;
  const readings =
    current && timeZone
      ? selectHourlyReadings(weather.hours, { date: selectedDate, timeZone, now })
      : [];
  return { current, forecast, readings };
}

export function selectLocationWeather(weather: LocationWeather, now = new Date()) {
  const timeZone = weather.location.timeZone;
  if (weather.current && !isCurrentReadingStale(weather.current.observedAt, timeZone, now)) {
    return { kind: 'current' as const, current: weather.current };
  }
  try {
    const date = localDateInTimeZone(timeZone, now);
    const forecast = weather.forecast?.find((day) => day.date === date);
    return forecast ? { kind: 'forecast' as const, forecast } : null;
  } catch {
    return null;
  }
}
