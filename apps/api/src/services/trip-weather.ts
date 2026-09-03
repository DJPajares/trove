import { getPrismaClient } from '@trove/db';

import {
  CachedWeatherService,
  weatherPointKey,
  type CachedPointForecast,
} from './cached-weather.js';
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import { formatDateOnly, getLocalDate, resolveTripWeatherLocation } from './trip-rules.js';
import {
  WEATHER_ATTRIBUTION,
  WeatherService,
  type TemperatureUnit,
  type WeatherCurrentConditions,
  type WeatherPoint,
} from './weather.js';
import { isWithinForecastWindow, resolveForecastWindow } from './weather-window.js';

/**
 * A trip crossing more cities than this is asking one request to carry an
 * unbounded fan-out. Past the cap a day falls back to the trip's own location,
 * which is a blunter answer rather than a missing one.
 */
export const MAX_WEATHER_LOCATIONS = 10;

export class TripWeatherNotFoundError extends Error {
  constructor() {
    super('trip_not_found');
    this.name = 'TripWeatherNotFoundError';
  }
}

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

export type TripWeather = {
  attribution: { label: string; url: string };
  current: WeatherCurrentConditions | null;
  days: TripWeatherDay[];
  fetchedAt: string;
  horizon: { endDate: string; startDate: string };
  provider: 'open_meteo';
  temperatureUnit: TemperatureUnit;
};

export type TripWeatherOptions = {
  temperatureUnit: TemperatureUnit;
};

type PlaceRecord = Parameters<typeof serializeCanonicalPlace>[0];

export type WeatherDayRecord = {
  dailyBaseTripPlace?: { place: PlaceRecord } | null;
  date: Date;
  defaultTimeZone: string;
  id: string;
  items: { tripPlace?: { place: PlaceRecord } | null }[];
};

const tripInclude = {
  destinations: {
    include: { place: { include: placeProviderRefInclude } },
    orderBy: { position: 'asc' as const },
  },
  itineraryDays: {
    include: {
      dailyBaseTripPlace: { include: { place: { include: placeProviderRefInclude } } },
      items: {
        include: { tripPlace: { include: { place: { include: placeProviderRefInclude } } } },
        orderBy: { position: 'asc' as const },
      },
    },
    orderBy: { date: 'asc' as const },
  },
} as const;

/** Celsius is what the cache stores; this is the only place a unit is applied. */
function toPreferredUnit(celsius: number, unit: TemperatureUnit) {
  return unit === 'fahrenheit' ? celsius * (9 / 5) + 32 : celsius;
}

function placeLocation(place: PlaceRecord | null | undefined) {
  if (!place) return null;
  return serializeCanonicalPlace({ ...place, providerRefs: place.providerRefs ?? [] }).location;
}

/**
 * Where a day's weather is, in the order a traveller would answer it.
 *
 * The bed comes first: a forecast is mostly read to decide what to wear
 * tomorrow morning, and that happens where the day starts. Only when a day has
 * no base does its first located stop stand in, and only when a day is empty
 * entirely does the trip's own location answer.
 */
export function resolveDayWeatherLocation(
  day: WeatherDayRecord,
  fallback: TripWeatherLocation | null,
): TripWeatherLocation | null {
  const base = placeLocation(day.dailyBaseTripPlace?.place);
  if (base) return { ...base, timeZone: base.timeZone ?? day.defaultTimeZone };

  for (const item of day.items) {
    const location = placeLocation(item.tripPlace?.place);
    if (location) return { ...location, timeZone: location.timeZone ?? day.defaultTimeZone };
  }

  return fallback;
}

async function findOwnedTrip(userId: string, tripId: string) {
  const trip = await getPrismaClient().trip.findFirst({
    include: tripInclude,
    where: { id: tripId, ownerId: userId },
  });
  if (!trip) throw new TripWeatherNotFoundError();
  return trip;
}

/**
 * The whole trip's weather, one day at a time, for the price of one request.
 *
 * Every screen that shows weather - Today, the day rail, the trip overview, the
 * Now card, the home ribbon - asks this one question about the trip rather than
 * a separate question per coordinate. Days the provider cannot reach yet are
 * absent from `days` rather than present and empty, so a surface can tell "not
 * forecast yet" from "no weather here" without inspecting a temperature.
 */
export class TripWeatherService {
  constructor(
    private readonly forecasts: CachedWeatherService = new CachedWeatherService(),
    private readonly currentConditions: WeatherService = new WeatherService(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getTripWeather(
    userId: string,
    tripId: string,
    options: TripWeatherOptions,
  ): Promise<TripWeather> {
    const trip = await findOwnedTrip(userId, tripId);
    const now = this.now();

    const tripLocation = resolveTripWeatherLocation(
      trip.destinations.map((destination) => ({
        location: placeLocation(destination.place),
        timeZone: destination.timeZone,
      })),
      trip.referenceTimeZone,
    );

    const located = trip.itineraryDays.flatMap((day) => {
      const location = resolveDayWeatherLocation(day, tripLocation);
      return location ? [{ date: formatDateOnly(day.date), day, location }] : [];
    });

    const window = resolveForecastWindow(
      [...new Set(located.map((entry) => entry.location.timeZone))],
      now,
    );

    // Only days the provider could actually answer put a coordinate on the
    // request. A trip three months out reaches this line and leaves with an
    // empty point list, which is what makes it cost nothing.
    const reachable = located.filter((entry) => isWithinForecastWindow(entry.date, window));
    const points = new Map<string, WeatherPoint>();

    // The trip's own location is claimed first so it is always available as the
    // fallback for a day the cap turned away.
    if (reachable.length && tripLocation) {
      points.set(weatherPointKey(tripLocation), {
        latitude: tripLocation.latitude,
        longitude: tripLocation.longitude,
      });
    }
    for (const entry of reachable) {
      const key = weatherPointKey(entry.location);
      if (points.has(key) || points.size >= MAX_WEATHER_LOCATIONS) continue;
      points.set(key, { latitude: entry.location.latitude, longitude: entry.location.longitude });
    }

    const answers: Map<string, CachedPointForecast> = points.size
      ? await this.forecasts.getForecasts([...points.values()], window)
      : new Map();
    const fallbackKey = tripLocation ? weatherPointKey(tripLocation) : null;

    const days: TripWeatherDay[] = [];
    let oldestFetchedAt: Date | null = null;

    for (const entry of reachable) {
      const forecast =
        answers.get(weatherPointKey(entry.location)) ??
        (fallbackKey ? answers.get(fallbackKey) : undefined);
      const match = forecast?.days.find((candidate) => candidate.date === entry.date);
      if (!forecast || !match) continue;

      if (!oldestFetchedAt || forecast.fetchedAt < oldestFetchedAt) {
        oldestFetchedAt = forecast.fetchedAt;
      }

      days.push({
        date: entry.date,
        itineraryDayId: entry.day.id,
        location: forecast.location,
        precipitationProbability: match.precipitationProbability,
        temperatureMax: toPreferredUnit(match.temperatureMax, options.temperatureUnit),
        temperatureMin: toPreferredUnit(match.temperatureMin, options.temperatureUnit),
        weatherCode: match.weatherCode,
      });
    }

    return {
      attribution: WEATHER_ATTRIBUTION,
      current: await this.readCurrent(days, tripLocation, options.temperatureUnit, now),
      days,
      fetchedAt: (oldestFetchedAt ?? now).toISOString(),
      horizon: window,
      provider: 'open_meteo',
      temperatureUnit: options.temperatureUnit,
    };
  }

  /**
   * Current conditions never come from the daily snapshot. That snapshot may be
   * three hours old, and PRD 11 is explicit that cached weather must not be
   * presented as the weather right now, so this reads the short-lived tier and
   * returns nothing rather than something stale.
   *
   * It only runs when today is a day of this trip. A trip that starts in March
   * has no "right now" to report, and asking anyway would spend a request on an
   * answer no surface would draw.
   */
  private async readCurrent(
    days: readonly TripWeatherDay[],
    fallback: TripWeatherLocation | null,
    temperatureUnit: TemperatureUnit,
    now: Date,
  ) {
    const anchor = fallback ?? days[0]?.location ?? null;
    if (!anchor) return null;

    const today = getLocalDate(now, anchor.timeZone);
    const location = days.find((day) => day.date === today)?.location ?? null;
    if (!location) return null;

    try {
      const weather = await this.currentConditions.getWeather({
        latitude: location.latitude,
        longitude: location.longitude,
        temperatureUnit,
        timeZone: location.timeZone,
      });
      return weather.current;
    } catch {
      // A fortnight of forecasts is worth serving even when the reading for this
      // minute is not.
      return null;
    }
  }
}
