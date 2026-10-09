import { weatherLocationKey, type WeatherLocation, type WeatherPointEvidence } from '@trove/types';
import { createWeatherStorage } from './storage';

/** Migrate only evidence with an explicit point and source age; archives are already independent. */
export async function migratePersistedWeather(
  userId: string,
  value: string,
  canWrite: () => boolean = () => true,
) {
  try {
    const client = JSON.parse(value);
    const queries = client?.clientState?.queries;
    if (!Array.isArray(queries)) return value;
    const storage = createWeatherStorage(userId, undefined, canWrite);
    for (const query of queries) {
      if (!['trip-weather', 'location-weather'].includes(query.queryKey?.[0])) continue;
      const data = query.state?.data;
      if (!data || !Number.isFinite(Date.parse(data.fetchedAt))) continue;
      const unit =
        data.temperatureUnit ?? query.queryKey[query.queryKey[0] === 'location-weather' ? 4 : 3];
      const celsius = (temperature: number) =>
        unit === 'fahrenheit' ? ((temperature - 32) * 5) / 9 : temperature;
      const points = new Map<string, WeatherPointEvidence>();
      const add = (location: WeatherLocation, days: WeatherPointEvidence['days']) => {
        if (
          !location ||
          !Number.isFinite(location.latitude) ||
          !Number.isFinite(location.longitude) ||
          !location.timeZone
        )
          return;
        const key = `point:${weatherLocationKey(location)}`;
        const current = points.get(key) ?? {
          location,
          days: [],
          current: null,
          hours: [],
          currentFetchedAt: null,
        };
        current.days.push(
          ...days.map((day) => ({
            ...day,
            temperatureMax: celsius(day.temperatureMax),
            temperatureMin: celsius(day.temperatureMin),
          })),
        );
        points.set(key, current);
      };
      if (query.queryKey[0] === 'location-weather') {
        add(
          data.location,
          (data.forecast ?? []).map((day: WeatherPointEvidence['days'][number]) => ({
            ...day,
            fetchedAt: day.fetchedAt ?? data.fetchedAt,
          })),
        );
        const point = points.values().next().value;
        if (point) {
          point.currentFetchedAt = data.fetchedAt;
          point.current = data.current
            ? {
                ...data.current,
                temperature: celsius(data.current.temperature),
                apparentTemperature: celsius(data.current.apparentTemperature),
              }
            : null;
          point.hours = (data.hours ?? []).map((hour: WeatherPointEvidence['hours'][number]) => ({
            ...hour,
            temperature: celsius(hour.temperature),
          }));
        }
      } else
        for (const day of data.days ?? [])
          add(day.location, [{ ...day, fetchedAt: day.fetchedAt ?? data.fetchedAt }]);
      for (const [key, evidence] of points) {
        if (!(await storage.read(key))) await storage.write(key, { ...evidence, missing: {} });
      }
    }
    const retained = queries.filter(
      (query: { queryKey?: unknown[] }) =>
        !['trip-weather', 'location-weather'].includes(String(query.queryKey?.[0])),
    );
    return retained.length === queries.length
      ? value
      : JSON.stringify({ ...client, clientState: { ...client.clientState, queries: retained } });
  } catch {
    return value;
  }
}
