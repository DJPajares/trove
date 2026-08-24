import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import type { CachedWeatherContext } from '@/lib/weather/api';

export type HomeWeatherLocation = {
  latitude: number;
  longitude: number;
  timeZone: string;
};

export type HomeWeatherTarget = {
  date: string;
  kind: 'current' | 'forecast';
  location: HomeWeatherLocation;
};

function itemWeatherLocation(
  item: ItineraryItem | null,
  fallbackTimeZone: string,
): HomeWeatherLocation | null {
  const location = item?.tripPlace?.place.location;
  if (!location) return null;

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    timeZone: location.timeZone ?? item?.timeZone ?? fallbackTimeZone,
  };
}

export function resolveHomeWeatherTarget(
  trip: Trip,
  context: TripModeContext | null,
): HomeWeatherTarget | null {
  if (trip.lifecycle === 'completed') return null;

  if (trip.lifecycle === 'planning') {
    return trip.weatherLocation
      ? { date: trip.startDate, kind: 'forecast', location: trip.weatherLocation }
      : null;
  }

  const currentItem =
    context?.day?.items.find((item) => item.id === context.currentOrRelevant?.itemId) ?? null;
  const nextItem = context?.day?.items.find((item) => item.id === context.nextItemId) ?? null;
  const contextTimeZone = context?.day?.defaultTimeZone ?? trip.referenceTimeZone;
  const location =
    itemWeatherLocation(currentItem, contextTimeZone) ??
    itemWeatherLocation(nextItem, contextTimeZone) ??
    trip.weatherLocation ??
    null;

  return location
    ? {
        date: context?.selectedDate ?? trip.startDate,
        kind: 'current',
        location,
      }
    : null;
}

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function selectHomeWeatherReading(
  data: CachedWeatherContext,
  target: HomeWeatherTarget,
  now = new Date(),
) {
  const showCurrent =
    target.kind === 'current' &&
    target.date === localDate(now, target.location.timeZone) &&
    data.current !== null;

  if (showCurrent && data.current) {
    return { kind: 'current' as const, reading: data.current };
  }

  const forecast = data.forecast.find((entry) => entry.date === target.date) ?? null;
  return forecast
    ? { kind: 'forecast' as const, reading: forecast }
    : { kind: 'out_of_range' as const, reading: null };
}

export function weatherConditionKey(code: number) {
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77].includes(code)) return 'snow';
  if ([80, 81, 82].includes(code)) return 'showers';
  if ([85, 86].includes(code)) return 'snowShowers';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'unknown';
}
