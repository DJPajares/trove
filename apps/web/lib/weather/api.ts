import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import type { TemperatureUnit } from '@/lib/profile/preferences';

/**
 * Bumped whenever the shape below changes.
 *
 * The query cache is written to disk and never refetched on a timer, so without
 * a version in the key a returning traveller keeps reading an answer the server
 * has already stopped producing.
 */
export const WEATHER_CONTRACT_VERSION = 'v2';

export type WeatherCurrentConditions = {
  apparentTemperature: number;
  isDay: boolean;
  observedAt: string;
  temperature: number;
  weatherCode: number;
};

/**
 * One hour of the day, in the traveller's unit and the day's own zone.
 *
 * `time` is the provider's local-time string - `2026-09-11T15:00`, minute
 * precision, no zone - so the day an hour belongs to is readable from the value
 * without another field to trust.
 */
export type WeatherHourlyForecast = {
  precipitationProbability: number | null;
  temperature: number;
  time: string;
  weatherCode: number;
};

export type TripWeatherLocation = {
  latitude: number;
  longitude: number;
  timeZone: string;
};

export type TripWeatherDay = {
  date: string;
  itineraryDayId: string;
  location: TripWeatherLocation;
  precipitationProbability: number | null;
  temperatureMax: number;
  temperatureMin: number;
  weatherCode: number;
};

/**
 * A trip's weather, one day at a time.
 *
 * `days` carries only the days the provider could actually answer. A day past
 * the horizon is absent rather than present and empty, so a surface can tell
 * "not forecast yet" from "no weather here" without inspecting a temperature.
 */
export type TripWeather = {
  attribution: {
    label: string;
    url: string;
  };
  current: WeatherCurrentConditions | null;
  days: TripWeatherDay[];
  fetchedAt: string;
  horizon: { endDate: string; startDate: string };
  /**
   * The next stretch of hours where the traveller is today, empty whenever
   * `current` is - both come from the same live reading and neither means
   * anything without it.
   */
  hours: WeatherHourlyForecast[];
  provider: 'open_meteo';
  temperatureUnit: TemperatureUnit;
};

export type TripWeatherRequest = {
  signal?: AbortSignal;
  temperatureUnit: TemperatureUnit;
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

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new WeatherApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new WeatherApiError('not_authenticated', 401);
  return data.session.access_token;
}

export async function getTripWeather(
  tripId: string,
  { signal, temperatureUnit }: TripWeatherRequest,
): Promise<TripWeather> {
  const accessToken = await getAccessToken();
  const query = new URLSearchParams({ temperatureUnit });

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/trips/${tripId}/weather?${query.toString()}`, {
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

  return response.json() as Promise<TripWeather>;
}

export type LocationWeather = {
  attribution: { label: string; url: string };
  current: WeatherCurrentConditions | null;
  fetchedAt: string;
  location: { latitude: number; longitude: number; timeZone: string };
  /**
   * What the server called the place it resolved, when it resolved one.
   *
   * Null whenever coordinates were supplied: the reading is then exactly where
   * the traveller is, and the zone's city is not necessarily the city those
   * coordinates sit in, so the server declines to name it.
   */
  place: { name: string } | null;
};

export type LocationWeatherRequest = {
  /** Omitted together when the traveller has not shared a position. */
  latitude?: number;
  longitude?: number;
  signal?: AbortSignal;
  temperatureUnit: TemperatureUnit;
  timeZone: string;
};

/**
 * The weather at a point, for the traveller rather than for a trip.
 *
 * The same free provider and the same server-side cache the trip's weather
 * rides on, addressed by coordinate instead of by trip - Home asks where the
 * person is standing, which is a question no trip can answer.
 *
 * Only the fields Home reads are typed. The endpoint returns a fuller context;
 * declaring the rest here would be declaring a contract nothing depends on.
 */
export async function getLocationWeather({
  latitude,
  longitude,
  signal,
  temperatureUnit,
  timeZone,
}: LocationWeatherRequest): Promise<LocationWeather> {
  const accessToken = await getAccessToken();
  const query = new URLSearchParams({ temperatureUnit, timeZone });
  if (latitude !== undefined && longitude !== undefined) {
    query.set('latitude', String(latitude));
    query.set('longitude', String(longitude));
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/weather?${query.toString()}`, {
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

  return response.json() as Promise<LocationWeather>;
}
