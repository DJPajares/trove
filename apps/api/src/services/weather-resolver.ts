import {
  weatherForecastWindow,
  weatherLocalDate,
  weatherCoordinate,
  WEATHER_MAX_LOCATIONS,
  type WeatherResolvePoint,
  type WeatherPointEvidence,
} from '@trove/types';
import {
  CachedWeatherService,
  weatherPointKey,
  type CachedPointForecast,
} from './cached-weather.js';
import { WeatherService, type WeatherContext } from './weather.js';

/** Public point evidence: trip ownership/mapping is a separate metadata concern. */
export class WeatherResolver {
  constructor(
    private readonly forecasts = new CachedWeatherService(),
    private readonly live = new WeatherService(),
    private readonly now = () => new Date(),
  ) {}
  async resolve(input: readonly WeatherResolvePoint[]): Promise<WeatherPointEvidence[]> {
    if (input.length > WEATHER_MAX_LOCATIONS) throw new Error('too_many_weather_locations');
    const now = this.now();
    const window = weatherForecastWindow(
      input.map((point) => point.timeZone),
      now,
    );
    const normalized = input.map((point) => ({
      ...point,
      latitude: weatherCoordinate(point.latitude),
      longitude: weatherCoordinate(point.longitude),
      dates: point.dates.filter((date) => date >= window.startDate && date <= window.endDate),
      current: Boolean(
        point.current &&
        (point.dates.length === 0 || point.dates.includes(weatherLocalDate(now, point.timeZone))),
      ),
    }));
    const merged = new Map<string, WeatherResolvePoint>();
    for (const point of normalized) {
      const key = weatherPointKey(point),
        previous = merged.get(key);
      merged.set(
        key,
        previous
          ? {
              ...point,
              dates: [...new Set([...previous.dates, ...point.dates])],
              current: previous.current || point.current,
            }
          : point,
      );
    }
    const requests = [...merged.values()];
    const contexts = new Map<string, WeatherContext>();
    await Promise.all(
      requests
        .filter((point) => point.current)
        .map(async (point) => {
          try {
            contexts.set(
              weatherPointKey(point),
              await this.live.getWeather({ ...point, temperatureUnit: 'celsius' }),
            );
          } catch {
            /* A daily forecast remains useful without a live response. */
          }
        }),
    );
    const required = new Map(
      requests
        .filter((point) => point.dates.length)
        .map((point) => [
          weatherPointKey(point),
          {
            startDate: [...point.dates].sort()[0]!,
            endDate: [...point.dates].sort().at(-1)!,
          },
        ]),
    );
    const points = [
      ...new Map(
        requests
          .filter((point) => point.dates.length)
          .map((point) => [weatherPointKey(point), point]),
      ).values(),
    ];
    const forecasts: Map<string, CachedPointForecast> = points.length
      ? await this.forecasts.getForecasts(points, window, required)
      : new Map();
    return requests.map((point) => {
      const context = contexts.get(weatherPointKey(point));
      const forecast = forecasts.get(weatherPointKey(point));
      if (point.current && !context && !forecast) throw new Error('weather_unavailable');
      return {
        location: {
          latitude: point.latitude,
          longitude: point.longitude,
          timeZone: point.timeZone,
        },
        days: forecast
          ? forecast.days.map((day) => ({ ...day, fetchedAt: forecast.fetchedAt.toISOString() }))
          : context
            ? context.forecast.map((day) => ({ ...day, fetchedAt: context.fetchedAt }))
            : [],
        current: context?.current ?? null,
        hours: context?.hours ?? [],
        currentFetchedAt: context?.fetchedAt ?? null,
      };
    });
  }
}
