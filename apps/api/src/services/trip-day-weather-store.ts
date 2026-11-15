import { getPrismaClient, Prisma } from '@trove/db';

import { weatherPointKey } from './cached-weather.js';
import type { WeatherDailyForecast, WeatherHourlyForecast } from './weather.js';

/**
 * How far back the provider answers for a day already gone. Open-Meteo's
 * forecast endpoint accepts dates about ninety-three days back; asking past
 * that is a 400, so older days are never asked for.
 */
export const WEATHER_PAST_REACH_DAYS = 90;

export type StoredDayWeather = {
  date: string;
  fetchedAt: Date;
  itineraryDayId: string;
  location: { latitude: number; longitude: number; timeZone: string };
  lockedAt: Date | null;
  /** Celsius, as stored. */
  forecast: WeatherDailyForecast;
  /** The day's hours, in celsius, kept when the day arrived; null before then. */
  hours: WeatherHourlyForecast[] | null;
};

function toNumber(value: number | { toNumber(): number }) {
  return typeof value === 'number' ? value : value.toNumber();
}

/** Every day of a trip that has weather kept for it, by itinerary day. */
export async function readStoredDayWeather(tripId: string) {
  const rows = await getPrismaClient().tripDayWeather.findMany({ where: { tripId } });
  return new Map<string, StoredDayWeather>(
    rows.map((row) => {
      const date = row.date.toISOString().slice(0, 10);
      return [
        row.itineraryDayId,
        {
          date,
          fetchedAt: row.fetchedAt,
          forecast: {
            date,
            precipitationProbability: row.precipitationProbability,
            temperatureMax: toNumber(row.temperatureMaxCelsius),
            temperatureMin: toNumber(row.temperatureMinCelsius),
            weatherCode: row.weatherCode,
          },
          hours: Array.isArray(row.hours) ? (row.hours as WeatherHourlyForecast[]) : null,
          itineraryDayId: row.itineraryDayId,
          location: {
            latitude: toNumber(row.latitude),
            longitude: toNumber(row.longitude),
            timeZone: row.timeZone,
          },
          lockedAt: row.lockedAt,
        },
      ] as const;
    }),
  );
}

/** Keeps a day's weather against the trip, replacing what it had. */
export async function writeStoredDayWeather(tripId: string, rows: readonly StoredDayWeather[]) {
  if (!rows.length) return;
  const prisma = getPrismaClient();
  await Promise.all(
    rows.map((row) => {
      const data = {
        date: new Date(`${row.date}T00:00:00.000Z`),
        fetchedAt: row.fetchedAt,
        hours: row.hours ?? Prisma.DbNull,
        latitude: row.location.latitude,
        lockedAt: row.lockedAt,
        longitude: row.location.longitude,
        precipitationProbability: row.forecast.precipitationProbability,
        temperatureMaxCelsius: row.forecast.temperatureMax,
        temperatureMinCelsius: row.forecast.temperatureMin,
        timeZone: row.location.timeZone,
        tripId,
        weatherCode: row.forecast.weatherCode,
      };
      return prisma.tripDayWeather.upsert({
        create: { ...data, itineraryDayId: row.itineraryDayId },
        update: data,
        where: { itineraryDayId: row.itineraryDayId },
      });
    }),
  );
}

/** Marks a kept day final without asking the provider again. */
export async function lockStoredDayWeather(itineraryDayIds: readonly string[], lockedAt: Date) {
  if (!itineraryDayIds.length) return;
  await getPrismaClient().tripDayWeather.updateMany({
    data: { lockedAt },
    where: { itineraryDayId: { in: [...itineraryDayIds] }, lockedAt: null },
  });
}

/** Whether a kept day is still about the place the day is now in. */
export function samePlace(
  stored: StoredDayWeather['location'],
  current: { latitude: number; longitude: number; timeZone: string },
) {
  return weatherPointKey(stored) === weatherPointKey(current);
}
