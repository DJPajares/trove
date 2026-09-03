import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import type { TemperatureUnit } from '@/lib/profile/preferences';

/**
 * Bumped whenever the shape below changes.
 *
 * The query cache is written to disk and never refetched on a timer, so without
 * a version in the key a returning traveller keeps reading an answer the server
 * has already stopped producing.
 */
export const WEATHER_CONTRACT_VERSION = 'v1';

export type WeatherCurrentConditions = {
  apparentTemperature: number;
  isDay: boolean;
  observedAt: string;
  temperature: number;
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
