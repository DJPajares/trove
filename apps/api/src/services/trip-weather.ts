import { weatherDayLocations, WEATHER_MAX_LOCATIONS, type WeatherLocations } from '@trove/types';
import {
  resolveDayStay,
  tripStayInclude,
  stayAccommodationsInclude,
  toStayAccommodations,
} from './day-stay.js';
import { getPrismaClient } from '@trove/db';
import { stayDayTimeZone } from './stay-time-zone.js';

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
  type WeatherHourlyForecast,
  type WeatherPoint,
} from './weather.js';
import { isWithinForecastWindow, resolveForecastWindow } from './weather-window.js';
import {
  lockStoredDayWeather,
  readStoredDayWeather,
  samePlace,
  WEATHER_PAST_REACH_DAYS,
  writeStoredDayWeather,
  type StoredDayWeather,
} from './trip-day-weather-store.js';

/** A date-only string moved by whole days, without touching a time zone. */
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * A trip crossing more cities than this is asking one request to carry an
 * unbounded fan-out. Past the cap a day falls back to the trip's own location,
 * which is a blunter answer rather than a missing one.
 */
export const MAX_WEATHER_LOCATIONS = WEATHER_MAX_LOCATIONS;

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
  fetchedAt?: string;
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
  currentFetchedAt: string | null;
  horizon: { endDate: string; startDate: string };
  /**
   * Today's hours, kept when the day arrived, from the hour it was read. There
   * is no live reading: `current` is always null, and a screen takes "this
   * hour" from these. `currentFetchedAt` is when they were read.
   */
  hours: WeatherHourlyForecast[];
  /**
   * Which trip day those hours describe - today, wherever the traveller is.
   *
   * A surface drawing some other day compares against this before showing an
   * hour, because a trip that moves on tomorrow would otherwise read this
   * city's rain against the next city's afternoon, which PRD 21.1 calls
   * fabricating a forecast. It is the day rather than a coordinate because a
   * day past `MAX_WEATHER_LOCATIONS` carries the trip's fallback location
   * rather than its own: comparing coordinates would then quietly hand today's
   * hours to a city the traveller is not in. Null whenever `hours` is empty.
   */
  hoursDate: string | null;
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
  ...tripStayInclude({ include: { place: { include: placeProviderRefInclude } } }),
  reservations: stayAccommodationsInclude({
    include: { place: { include: placeProviderRefInclude } },
  }),
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
  if (base)
    return {
      ...base,
      timeZone: base.timeZone ?? day.defaultTimeZone,
    };

  for (const item of day.items) {
    const location = placeLocation(item.tripPlace?.place);
    if (location)
      return {
        ...location,
        timeZone: location.timeZone ?? day.defaultTimeZone,
      };
  }

  return fallback;
}

/**
 * Every day's location, including the days that have nothing to say for
 * themselves.
 *
 * The trip's destination answers for an empty day first, because it is what the
 * traveller said the trip was about. But a destination named rather than picked
 * carries no coordinates - an AI-planned trip routinely arrives here with three
 * of them and not a latitude between them - and a trip with no destinations at
 * all is ordinary. So an empty day then borrows from the nearest day that is
 * located, in days, rather than from the first one.
 *
 * Nearest matters more than it sounds. A trip's first located place is very
 * often the bed the traveller left home from, half a continent from anywhere
 * the trip actually goes: a blank New Zealand day would read 33° because the
 * itinerary starts in Singapore. The day before is where they woke up, which is
 * both nearer and the same reason the bed comes first above. Ties go to it.
 */
export function resolveDayWeatherLocations(
  days: readonly WeatherDayRecord[],
  destination: TripWeatherLocation | null,
): (TripWeatherLocation | null)[] {
  const own = days.map((day) => resolveDayWeatherLocation(day, null));

  return weatherDayLocations(own, destination);
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
    const mapping = await this.getLocations(userId, tripId);
    const now = this.now();
    const located = mapping.days.flatMap((day) =>
      day.location ? [{ date: day.date, day: { id: day.id }, location: day.location }] : [],
    );
    const window = resolveForecastWindow(
      [...new Set(located.map((entry) => entry.location.timeZone))],
      now,
    );

    // What each day already has kept against the trip decides whether the
    // provider is asked at all. A day is asked once while it is ahead, and
    // once more when it arrives, after which it is locked and never asked
    // again; a day whose stay or stops moved is asked again for its new place
    // until it is locked.
    const stored = await readStoredDayWeather(tripId);
    const kept = new Map<string, StoredDayWeather>();
    const ahead: typeof located = [];
    const arriving: typeof located = [];
    const past: typeof located = [];
    const finalise: string[] = [];

    for (const entry of located) {
      const today = getLocalDate(now, entry.location.timeZone);
      const row = stored.get(entry.day.id);
      const sameDate = row?.date === entry.date;
      const here = row && sameDate && samePlace(row.location, entry.location) ? row : null;

      if (row && sameDate && row.lockedAt) {
        kept.set(entry.day.id, row);
        continue;
      }
      if (here) kept.set(entry.day.id, here);
      if (entry.date > today) {
        if (!here && isWithinForecastWindow(entry.date, window)) ahead.push(entry);
      } else if (entry.date === today && isWithinForecastWindow(entry.date, window)) {
        arriving.push(entry);
      } else if (entry.date >= shiftDate(today, -WEATHER_PAST_REACH_DAYS)) {
        past.push(entry);
      } else if (here) {
        finalise.push(entry.day.id);
      }
    }

    const tripLocation = mapping.fallback;
    const fallbackKey = tripLocation ? weatherPointKey(tripLocation) : null;
    const pointsFor = (entries: typeof located) => {
      const points = new Map<string, WeatherPoint>();
      // The trip's own location is claimed first so it is always available as
      // the fallback for a day the cap turned away.
      if (entries.length && tripLocation) {
        points.set(weatherPointKey(tripLocation), { ...tripLocation });
      }
      for (const entry of entries) {
        const key = weatherPointKey(entry.location);
        if (points.has(key) || points.size >= MAX_WEATHER_LOCATIONS) continue;
        points.set(key, { ...entry.location });
      }
      return [...points.values()];
    };
    const written: StoredDayWeather[] = [];
    const take = (entries: typeof located, answers: Map<string, CachedPointForecast>) => {
      for (const entry of entries) {
        const forecast =
          answers.get(weatherPointKey(entry.location)) ??
          (fallbackKey ? answers.get(fallbackKey) : undefined);
        const match = forecast?.days.find((candidate) => candidate.date === entry.date);
        if (!forecast || !match) continue;
        const row: StoredDayWeather = {
          date: entry.date,
          fetchedAt: forecast.fetchedAt,
          forecast: match,
          hours: null,
          itineraryDayId: entry.day.id,
          location: forecast.location,
          lockedAt: entry.date <= getLocalDate(now, entry.location.timeZone) ? now : null,
        };
        kept.set(entry.day.id, row);
        written.push(row);
      }
    };

    if (ahead.length) {
      try {
        take(ahead, await this.forecasts.getForecasts(pointsFor(ahead), window));
      } catch {
        /* Whatever is kept still answers; the next read asks again. */
      }
    }
    // The day that arrives is read once, with its hours, and locked: one
    // request per place, after which "this hour" comes from what was kept.
    if (arriving.length) {
      // As for the daily read: the trip's own place is claimed first, so a day
      // the cap turns away borrows it without asking for an extra place.
      const byPoint = new Map<string, { entries: typeof located; point: TripWeatherLocation }>();
      if (tripLocation && fallbackKey)
        byPoint.set(fallbackKey, { entries: [], point: { ...tripLocation } });
      for (const entry of arriving) {
        let key = weatherPointKey(entry.location);
        if (!byPoint.has(key)) {
          if (byPoint.size >= MAX_WEATHER_LOCATIONS && fallbackKey) key = fallbackKey;
          else byPoint.set(key, { entries: [], point: { ...entry.location } });
        }
        byPoint.get(key)!.entries.push(entry);
      }
      await Promise.all(
        [...byPoint.values()].map(async ({ entries, point }) => {
          if (!entries.length) return;
          try {
            const context = await this.currentConditions.getWeather({
              latitude: point.latitude,
              longitude: point.longitude,
              temperatureUnit: 'celsius',
              timeZone: point.timeZone,
            });
            for (const entry of entries) {
              const match = context.forecast.find((day) => day.date === entry.date);
              if (!match) continue;
              const row: StoredDayWeather = {
                date: entry.date,
                fetchedAt: new Date(context.fetchedAt),
                forecast: match,
                hours: context.hours.filter((hour) => hour.time.startsWith(entry.date)),
                itineraryDayId: entry.day.id,
                location: context.location,
                lockedAt: now,
              };
              kept.set(entry.day.id, row);
              written.push(row);
            }
          } catch {
            /* What was kept still answers; the next read tries once more. */
          }
        }),
      );
    }
    if (past.length) {
      const dates = past.map((entry) => entry.date).toSorted();
      try {
        take(
          past,
          await this.forecasts.getPastDays(pointsFor(past), {
            endDate: dates.at(-1)!,
            startDate: dates[0]!,
          }),
        );
      } catch {
        /* As above: kept weather stands, and a later read tries once more. */
      }
    }
    await writeStoredDayWeather(tripId, written);
    await lockStoredDayWeather(finalise, now);

    const days: TripWeatherDay[] = [];
    let oldestFetchedAt: Date | null = null;
    for (const entry of located) {
      const row = kept.get(entry.day.id);
      if (!row) continue;
      if (!oldestFetchedAt || row.fetchedAt < oldestFetchedAt) oldestFetchedAt = row.fetchedAt;
      days.push({
        fetchedAt: row.fetchedAt.toISOString(),
        date: entry.date,
        itineraryDayId: entry.day.id,
        location: row.location,
        precipitationProbability: row.forecast.precipitationProbability,
        temperatureMax: toPreferredUnit(row.forecast.temperatureMax, options.temperatureUnit),
        temperatureMin: toPreferredUnit(row.forecast.temperatureMin, options.temperatureUnit),
        weatherCode: row.forecast.weatherCode,
      });
    }

    // Today's hours, as kept when the day arrived. The screens take "this hour"
    // from them, so nothing live is asked for on a read.
    const todayEntry = located.find(
      (entry) => entry.date === getLocalDate(now, entry.location.timeZone),
    );
    const todayRow = todayEntry ? kept.get(todayEntry.day.id) : undefined;
    const hours = (todayRow?.hours ?? []).map((hour) => ({
      ...hour,
      temperature: toPreferredUnit(hour.temperature, options.temperatureUnit),
    }));
    const live = {
      current: null,
      date: hours.length ? todayEntry!.date : null,
      fetchedAt: hours.length ? todayRow!.fetchedAt.toISOString() : null,
      hours,
    };

    return {
      attribution: WEATHER_ATTRIBUTION,
      current: live.current,
      currentFetchedAt: live.fetchedAt,
      days,
      fetchedAt: oldestFetchedAt?.toISOString() ?? live.fetchedAt ?? '',
      horizon: window,
      hours: live.hours,
      hoursDate: live.date,
      provider: 'open_meteo',
      temperatureUnit: options.temperatureUnit,
    };
  }

  /** Metadata only: this path never reads weather tables or calls a provider. */
  async getLocations(userId: string, tripId: string): Promise<WeatherLocations> {
    const trip = await findOwnedTrip(userId, tripId);
    const destination = resolveTripWeatherLocation(
      trip.destinations.map((entry) => ({
        location: placeLocation(entry.place),
        timeZone: entry.timeZone,
      })),
      trip.referenceTimeZone,
    );
    const accommodations = toStayAccommodations(trip.reservations);
    const locations = resolveDayWeatherLocations(
      trip.itineraryDays.map((day) => {
        const stay = resolveDayStay(
          { ...day, dailyBaseDepartureTripPlace: null },
          accommodations,
          trip,
        );
        const places = [stay.start?.place, ...day.items.map((i) => i.tripPlace)].filter(
          (p): p is NonNullable<typeof p> => Boolean(p),
        );
        return {
          ...day,
          dailyBaseTripPlace: stay.start?.place ?? null,
          defaultTimeZone:
            trip.stayRanges?.length || day.date.getTime() === trip.startDate?.getTime()
              ? stayDayTimeZone({
                  start: stay.start,
                  places,
                  items: day.items,
                  tripTimeZone: trip.referenceTimeZone,
                }).timeZone
              : day.defaultTimeZone,
        };
      }),
      destination,
    );
    return {
      days: trip.itineraryDays.map((day, index) => ({
        id: day.id,
        date: formatDateOnly(day.date),
        location: locations[index] ?? null,
      })),
      fallback: destination ?? locations.find(Boolean) ?? null,
    };
  }
}
