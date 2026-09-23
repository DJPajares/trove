import type { TripWeatherDay } from '@/lib/weather/api';
import type { TemperatureUnit } from '@/lib/profile/preferences';

/**
 * Historical entries keep only the daily forecast values, normalized to
 * Celsius so changing the traveller's unit does not lose past readings.
 */
export type ArchivedTripWeatherDay = Omit<
  TripWeatherDay,
  'location' | 'temperatureMax' | 'temperatureMin'
> & {
  location: Pick<TripWeatherDay['location'], 'timeZone'>;
  temperatureMaxCelsius: number;
  temperatureMinCelsius: number;
};

function toCelsius(value: number, unit: TemperatureUnit) {
  return unit === 'fahrenheit' ? (value - 32) * (5 / 9) : value;
}

function fromCelsius(value: number, unit: TemperatureUnit) {
  return unit === 'fahrenheit' ? value * (9 / 5) + 32 : value;
}

function archiveKey(day: Pick<TripWeatherDay, 'date' | 'itineraryDayId'>) {
  return `${day.itineraryDayId}:${day.date}`;
}

export function mergeArchivedTripWeather(
  archived: readonly ArchivedTripWeatherDay[],
  fresh: readonly TripWeatherDay[],
  unit: TemperatureUnit,
): ArchivedTripWeatherDay[] {
  const days = new Map(archived.map((day) => [archiveKey(day), day]));

  for (const day of fresh) {
    days.set(archiveKey(day), {
      date: day.date,
      itineraryDayId: day.itineraryDayId,
      location: { timeZone: day.location.timeZone },
      precipitationProbability: day.precipitationProbability,
      temperatureMaxCelsius: toCelsius(day.temperatureMax, unit),
      temperatureMinCelsius: toCelsius(day.temperatureMin, unit),
      weatherCode: day.weatherCode,
    });
  }

  return [...days.values()].toSorted(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.itineraryDayId.localeCompare(right.itineraryDayId),
  );
}

export function restoreArchivedTripWeather(
  archived: readonly ArchivedTripWeatherDay[],
  unit: TemperatureUnit,
): TripWeatherDay[] {
  return archived.map((day) => ({
    date: day.date,
    itineraryDayId: day.itineraryDayId,
    location: { timeZone: day.location.timeZone },
    precipitationProbability: day.precipitationProbability,
    temperatureMax: fromCelsius(day.temperatureMaxCelsius, unit),
    temperatureMin: fromCelsius(day.temperatureMinCelsius, unit),
    weatherCode: day.weatherCode,
  }));
}

export function dateIsBeforeForecastWindow(
  horizon: Readonly<{ startDate: string }> | null,
  date: string,
) {
  return Boolean(horizon && date < horizon.startDate);
}
