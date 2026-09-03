import { afterEach, beforeEach, expect, test } from 'vitest';

import type { WeatherDailyForecast, WeatherPoint } from '../src/services/weather.js';

const NOW = new Date('2026-09-03T09:00:00.000Z');
const TOKYO = { latitude: 35.68, longitude: 139.69 };
const SAPPORO = { latitude: 43.06, longitude: 141.35 };

function providerPlace(id: string, point: WeatherPoint, timeZone: string | null = null) {
  return {
    customLatitude: point.latitude,
    customLongitude: point.longitude,
    customName: id,
    customNote: null,
    customTimeZone: timeZone,
    id,
    kind: 'CUSTOM' as const,
    providerAddress: null,
    providerLabel: null,
    providerRefs: [],
  };
}

function day(id: string, date: string, options: { base?: WeatherPoint; stop?: WeatherPoint } = {}) {
  return {
    dailyBaseTripPlace: options.base ? { place: providerPlace(`${id}-base`, options.base) } : null,
    date: new Date(`${date}T00:00:00.000Z`),
    defaultTimeZone: 'Asia/Tokyo',
    id,
    items: options.stop
      ? [{ tripPlace: { place: providerPlace(`${id}-stop`, options.stop) } }]
      : [],
  };
}

function createTrip(days: ReturnType<typeof day>[], destination: WeatherPoint | null = TOKYO) {
  return {
    destinations: destination
      ? [{ place: providerPlace('destination', destination), timeZone: 'Asia/Tokyo' }]
      : [],
    id: 'trip',
    itineraryDays: days,
    referenceTimeZone: 'Asia/Tokyo',
  };
}

function stubPrisma(trip: unknown) {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    trip: {
      async findFirst() {
        return trip;
      },
    },
  };
}

function createForecasts() {
  const batches: WeatherPoint[][] = [];

  return {
    batches,
    forecasts: {
      async getForecasts(
        points: readonly WeatherPoint[],
        window: { endDate: string; startDate: string },
      ) {
        batches.push([...points]);
        const { weatherPointKey } = await import('../src/services/cached-weather.js');
        return new Map(
          points.map((point) => [
            weatherPointKey(point),
            {
              days: [window.startDate, '2026-09-04', '2026-09-05'].map<WeatherDailyForecast>(
                (date) => ({
                  date,
                  precipitationProbability: 40,
                  // Sapporo is the colder of the two, so a mixed trip is visibly mixed.
                  temperatureMax: point.latitude > 40 ? 20 : 30,
                  temperatureMin: point.latitude > 40 ? 12 : 22,
                  weatherCode: 3,
                }),
              ),
              fetchedAt: NOW,
              location: { ...point, timeZone: 'Asia/Tokyo' },
              point,
            },
          ]),
        );
      },
    },
  };
}

const currentConditions = {
  async getWeather() {
    throw new Error('current conditions were not requested');
  },
};

async function createService(overrides: { forecasts?: unknown } = {}) {
  const { TripWeatherService } = await import('../src/services/trip-weather.js');
  const stub = createForecasts();
  return {
    batches: stub.batches,
    service: new TripWeatherService(
      (overrides.forecasts ?? stub.forecasts) as never,
      currentConditions as never,
      () => NOW,
    ),
  };
}

beforeEach(() => {
  delete (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient;
});

afterEach(() => {
  delete (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient;
});

test('a multi-city trip asks for each city once, in one batch', async () => {
  stubPrisma(
    createTrip([
      day('d1', '2026-09-03', { base: TOKYO }),
      day('d2', '2026-09-04', { base: TOKYO }),
      day('d3', '2026-09-05', { base: SAPPORO }),
    ]),
  );
  const { batches, service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(batches, 'one batch, not one per day').toHaveLength(1);
  expect(batches[0], 'Tokyo appears once despite two days').toHaveLength(2);
  expect(weather.days.map((entry) => entry.temperatureMax)).toEqual([30, 30, 20]);
});

test('a trip beyond the forecast horizon costs nothing', async () => {
  stubPrisma(
    createTrip([
      day('d1', '2026-12-01', { base: TOKYO }),
      day('d2', '2026-12-02', { base: TOKYO }),
    ]),
  );
  const { batches, service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(batches, 'no point may be asked about a date the provider refuses').toHaveLength(0);
  expect(weather.days).toEqual([]);
  expect(weather.horizon.endDate).toBe('2026-09-18');
});

test('days past the horizon are absent rather than empty', async () => {
  stubPrisma(
    createTrip([
      day('d1', '2026-09-03', { base: TOKYO }),
      day('d2', '2026-10-20', { base: TOKYO }),
    ]),
  );
  const { service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(weather.days.map((entry) => entry.itineraryDayId)).toEqual(['d1']);
});

test('a day without a base falls back to its first stop, then to the trip', async () => {
  const { resolveDayWeatherLocation } = await import('../src/services/trip-weather.js');
  const fallback = { ...TOKYO, timeZone: 'Asia/Tokyo' };

  expect(
    resolveDayWeatherLocation(day('d1', '2026-09-03', { base: SAPPORO, stop: TOKYO }), fallback),
  ).toMatchObject({ latitude: SAPPORO.latitude });
  expect(
    resolveDayWeatherLocation(day('d2', '2026-09-03', { stop: SAPPORO }), fallback),
  ).toMatchObject({ latitude: SAPPORO.latitude });
  expect(resolveDayWeatherLocation(day('d3', '2026-09-03'), fallback)).toEqual(fallback);
  expect(resolveDayWeatherLocation(day('d4', '2026-09-03'), null)).toBeNull();
});

test('an empty day borrows the nearest located day when no destination can answer', async () => {
  const { resolveDayWeatherLocations } = await import('../src/services/trip-weather.js');
  const destination = { ...TOKYO, timeZone: 'Asia/Tokyo' };
  const days = [day('d1', '2026-09-03'), day('d2', '2026-09-04', { stop: SAPPORO })];

  expect(
    resolveDayWeatherLocations(days, destination)[0],
    'a located destination answers first',
  ).toEqual(destination);
  expect(resolveDayWeatherLocations(days, null)[0]).toMatchObject({
    latitude: SAPPORO.latitude,
  });
  expect(resolveDayWeatherLocations([day('d1', '2026-09-03')], null)).toEqual([null]);
});

test('a gap day wakes up where it went to sleep, not where the trip began', async () => {
  const { resolveDayWeatherLocations } = await import('../src/services/trip-weather.js');
  // The shape that made this rule necessary: day one is the bed at home, and
  // the trip proper is somewhere else entirely.
  const HOME = { latitude: 1.35, longitude: 103.82 };
  const days = [
    day('d1', '2026-09-03', { base: HOME }),
    day('d2', '2026-09-04', { base: SAPPORO }),
    day('d3', '2026-09-05'),
    day('d4', '2026-09-06', { base: TOKYO }),
  ];

  const locations = resolveDayWeatherLocations(days, null);

  expect(locations[2], 'the day before, not the first day').toMatchObject({
    latitude: SAPPORO.latitude,
  });
});

test('an empty day borrows the trip even when the destination was only named', async () => {
  // What an AI-planned trip actually stores: "Hanoi, Vietnam" as a Place with a
  // name and no latitude. The trip is plainly somewhere; only the destination
  // cannot say where.
  const namedDestination = {
    ...providerPlace('destination', TOKYO),
    customLatitude: null,
    customLongitude: null,
  };
  stubPrisma({
    ...createTrip([day('d1', '2026-09-03'), day('d2', '2026-09-04', { base: SAPPORO })], null),
    destinations: [{ place: namedDestination, timeZone: 'Asia/Tokyo' }],
  });
  const { service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(weather.days.map((entry) => entry.itineraryDayId)).toEqual(['d1', 'd2']);
  expect(
    weather.days.map((entry) => entry.temperatureMax),
    'both days read Sapporo',
  ).toEqual([20, 20]);
});

test('a trip with nothing located anywhere asks for nothing', async () => {
  stubPrisma(createTrip([day('d1', '2026-09-03'), day('d2', '2026-09-04')], null));
  const { batches, service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(batches, 'nowhere to ask about is not a reason to ask').toHaveLength(0);
  expect(weather.days).toEqual([]);
});

test('a trip with more cities than the cap still answers every day', async () => {
  const { MAX_WEATHER_LOCATIONS } = await import('../src/services/trip-weather.js');
  const days = Array.from({ length: MAX_WEATHER_LOCATIONS + 4 }, (_, index) =>
    day(`d${index}`, '2026-09-03', {
      base: { latitude: 35 + index * 0.5, longitude: 139 + index * 0.5 },
    }),
  );
  stubPrisma(createTrip(days));
  const { batches, service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(batches[0]!.length).toBe(MAX_WEATHER_LOCATIONS);
  // Every day still gets a reading: the ones past the cap borrow the trip's own.
  expect(weather.days).toHaveLength(days.length);
});

test('fahrenheit converts on read rather than in the cache', async () => {
  stubPrisma(createTrip([day('d1', '2026-09-03', { base: TOKYO })]));
  const { service } = await createService();

  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'fahrenheit' });

  expect(weather.temperatureUnit).toBe('fahrenheit');
  expect(weather.days[0]!.temperatureMax).toBe(86);
  expect(weather.days[0]!.temperatureMin).toBeCloseTo(71.6);
});

test('current conditions are never taken from the daily snapshot', async () => {
  stubPrisma(createTrip([day('d1', '2026-09-03', { base: TOKYO })]));
  const { service } = await createService();

  // The stubbed current-conditions tier throws, which is the stale-weather case.
  const weather = await service.getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(weather.current, 'a failed reading must not fall back to a forecast').toBeNull();
  expect(weather.days).toHaveLength(1);
});

test('a trip that is not happening today asks for no current conditions', async () => {
  let asked = 0;
  const { TripWeatherService } = await import('../src/services/trip-weather.js');
  const stub = createForecasts();
  // Every day of this trip is in the future, so "right now" is not a question
  // any surface would draw an answer to.
  stubPrisma(createTrip([day('d1', '2026-09-05', { base: TOKYO })]));

  const weather = await new TripWeatherService(
    stub.forecasts as never,
    {
      async getWeather() {
        asked += 1;
        throw new Error('unreachable');
      },
    } as never,
    () => NOW,
  ).getTripWeather('owner', 'trip', { temperatureUnit: 'celsius' });

  expect(asked).toBe(0);
  expect(weather.current).toBeNull();
});

test('a trip that belongs to someone else is not found', async () => {
  stubPrisma(null);
  const { service } = await createService();

  await expect(
    service.getTripWeather('intruder', 'trip', { temperatureUnit: 'celsius' }),
  ).rejects.toMatchObject({ message: 'trip_not_found' });
});
