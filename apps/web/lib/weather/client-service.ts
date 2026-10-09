import type { QueryClient } from '@tanstack/react-query';
import { weatherDayLocations, type WeatherLocations, type WeatherLocation } from '@trove/types';
import {
  readTripSnapshot,
  readTripWeatherHistory,
  writeTripWeatherHistory,
} from '@/lib/offline/trip-store';
import type { Itinerary, ItineraryTripPlace } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import { fetchTripContext } from '@/lib/insights/api';
import { refreshScoresAfterWeatherAcquisition } from '@/lib/plan-score/lifecycle';
import {
  getLocationWeather,
  getTripWeatherLocations,
  resolveWeatherPoints,
  type TripWeather,
  type LocationWeather,
} from './api';
import { LocalWeatherService } from './service';
import { createWeatherStorage, withWeatherLocks } from './storage';
import type { TemperatureUnit } from '@/lib/profile/preferences';

const accounts = new WeakMap<QueryClient, string>();
const services = new WeakMap<
  QueryClient,
  { userId: string; service: LocalWeatherService; unsubscribe: () => void }
>();
export function deriveWeatherLocations(trip: Trip, itinerary: Itinerary): WeatherLocations | null {
  if (
    trip.id !== itinerary.trip.id ||
    trip.startDate !== itinerary.trip.startDate ||
    trip.endDate !== itinerary.trip.endDate
  )
    return null;
  const destination =
    trip.weatherLocation ??
    trip.destinations.flatMap((entry) =>
      entry.location
        ? [{ ...entry.location, timeZone: entry.timeZone ?? trip.referenceTimeZone }]
        : [],
    )[0] ??
    null;
  const location = (
    place: ItineraryTripPlace | null | undefined,
    zone: string,
  ): WeatherLocation | null =>
    place?.place.location
      ? { ...place.place.location, timeZone: place.place.location.timeZone ?? zone }
      : null;
  const own = itinerary.days.map((day) => {
    const stay = itinerary.tripPlaces.find(
      (place) => place.id === (day.stay?.startTripPlaceId ?? day.dailyBaseTripPlaceId),
    );
    return (
      location(stay, day.defaultTimeZone) ??
      day.items.map((item) => location(item.tripPlace, day.defaultTimeZone)).find(Boolean) ??
      null
    );
  });
  const locations = weatherDayLocations(own, destination);
  return {
    days: itinerary.days.map((day, index) => ({
      id: day.id,
      date: day.date,
      location: locations[index] ?? null,
    })),
    fallback: destination ?? locations.find(Boolean) ?? null,
  };
}

export function bindWeatherAccount(client: QueryClient, userId: string) {
  accounts.set(client, userId);
  if (services.get(client)?.userId === userId) return services.get(client)!.service;
  services.get(client)?.service.dispose();
  services.get(client)?.unsubscribe();
  const controller = new AbortController();
  const mapping = async (tripId: string) => {
    const trip = client.getQueryData<{ trip: Trip }>(['trip', tripId])?.trip;
    const itinerary = client.getQueryData<Itinerary>(['itinerary', tripId]);
    if (trip && itinerary) return deriveWeatherLocations(trip, itinerary);
    try {
      const offline = await readTripSnapshot(userId, tripId);
      return offline?.trip && offline.itinerary
        ? deriveWeatherLocations(trip ?? offline.trip, itinerary ?? offline.itinerary)
        : null;
    } catch {
      return null;
    }
  };
  const service = new LocalWeatherService({
    userId,
    storage: createWeatherStorage(userId, controller.signal),
    mapping,
    lock: (keys, signal, work) => withWeatherLocks(userId, keys, signal, work),
    transport: {
      locations: getTripWeatherLocations,
      resolve: resolveWeatherPoints,
      location: getLocationWeather,
      context: (tripId, languageCode, signal) => fetchTripContext(tripId, { languageCode, signal }),
    },
    history: {
      read: (tripId) => readTripWeatherHistory(userId, tripId),
      write: (tripId, days) =>
        controller.signal.aborted
          ? Promise.resolve()
          : writeTripWeatherHistory(userId, tripId, days, () => !controller.signal.aborted),
    },
    onEvidence: (tripIds) => refreshScoresAfterWeatherAcquisition(client, tripIds),
  });
  const unsubscribeCache = client.getQueryCache().subscribe((event) => {
    const [root, id] = event.query.queryKey;
    if (typeof id !== 'string') return;
    if (event.type === 'removed' && root === 'trip-weather') void service.invalidateMapping(id);
    if (
      event.type === 'updated' &&
      event.action.type === 'success' &&
      (root === 'trip' || root === 'itinerary')
    ) {
      if (root === 'trip') {
        const trip = (event.query.state.data as { trip?: Trip } | undefined)?.trip;
        if (trip)
          void service.syncContextInput(
            id,
            'trip',
            JSON.stringify([trip.startDate, trip.endDate, trip.countries, trip.referenceTimeZone]),
          );
      } else {
        const itinerary = event.query.state.data as Itinerary | undefined;
        if (itinerary)
          void service.syncContextInput(
            id,
            'days',
            JSON.stringify(
              itinerary.days.map((day) => [
                day.id,
                day.date,
                day.defaultTimeZone,
                day.stay?.startTripPlaceId ?? day.dailyBaseTripPlaceId,
                day.items.map((item) => item.tripPlace?.place.location ?? null),
              ]),
            ),
          );
      }
      void mapping(id).then((value) => {
        if (value && !controller.signal.aborted) void service.syncMapping(id, value);
      });
    }
  });
  services.set(client, {
    userId,
    service,
    unsubscribe: () => {
      controller.abort();
      unsubscribeCache();
    },
  });
  return service;
}
export function hasWeatherAccount(client: QueryClient, userId: string) {
  return services.get(client)?.userId === userId;
}
export function getWeatherService(client: QueryClient) {
  const service =
    services.get(client)?.service ??
    (accounts.has(client) ? bindWeatherAccount(client, accounts.get(client)!) : null);
  if (!service) throw new Error('not_authenticated');
  return service;
}
export function disposeWeatherAccount(client: QueryClient, forgetAccount = false) {
  if (forgetAccount) accounts.delete(client);
  const current = services.get(client);
  current?.unsubscribe();
  current?.service.dispose();
  services.delete(client);
}
export function invalidateWeatherMapping(client: QueryClient, tripId: string) {
  return services.get(client)?.service.invalidateMapping(tripId) ?? Promise.resolve();
}
const temperature = (value: number, unit: TemperatureUnit) =>
  unit === 'fahrenheit' ? (value * 9) / 5 + 32 : value;
function currentUnit<T extends TripWeather['current']>(current: T, unit: TemperatureUnit) {
  return current
    ? {
        ...current,
        temperature: temperature(current.temperature, unit),
        apparentTemperature: temperature(current.apparentTemperature, unit),
      }
    : null;
}
export function tripWeatherUnit(weather: TripWeather, unit: TemperatureUnit): TripWeather {
  if (unit === 'celsius') return weather;
  return {
    ...weather,
    temperatureUnit: unit,
    current: currentUnit(weather.current, unit),
    days: weather.days.map((day) => ({
      ...day,
      temperatureMax: temperature(day.temperatureMax, unit),
      temperatureMin: temperature(day.temperatureMin, unit),
    })),
    hours: weather.hours.map((hour) => ({
      ...hour,
      temperature: temperature(hour.temperature, unit),
    })),
  };
}
export function locationWeatherUnit(
  weather: LocationWeather,
  unit: TemperatureUnit,
): LocationWeather {
  if (unit === 'celsius') return weather;
  return {
    ...weather,
    current: currentUnit(weather.current, unit),
    forecast: weather.forecast.map((day) => ({
      ...day,
      temperatureMax: temperature(day.temperatureMax, unit),
      temperatureMin: temperature(day.temperatureMin, unit),
    })),
    hours: weather.hours?.map((hour) => ({
      ...hour,
      temperature: temperature(hour.temperature, unit),
    })),
  };
}
