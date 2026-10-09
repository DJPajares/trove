import { afterEach, expect, test, vi } from 'vitest';

import {
  clearAllOfflineTripData,
  readTripWeatherHistory,
  removeTripOfflineData,
  writeTripWeatherHistory,
} from '../lib/offline/trip-store.ts';
import type { ArchivedTripWeatherDay } from '../lib/weather/history.ts';

import { FakeIndexedDbFactory } from './fake-indexed-db.ts';

const archivedDay: ArchivedTripWeatherDay = {
  date: '2026-09-20',
  itineraryDayId: 'past-day',
  location: { timeZone: 'Asia/Tokyo' },
  precipitationProbability: 20,
  temperatureMaxCelsius: 24,
  temperatureMinCelsius: 18,
  weatherCode: 2,
};

afterEach(() => vi.unstubAllGlobals());

test('trip deletion and private data cleanup remove archived forecasts', async () => {
  const browserWindow = Object.assign(new EventTarget(), {
    localStorage: { removeItem: vi.fn() },
  });
  vi.stubGlobal('indexedDB', new FakeIndexedDbFactory() as unknown as IDBFactory);
  vi.stubGlobal('IDBKeyRange', { only: (value: unknown) => ({ value }) });
  vi.stubGlobal('window', browserWindow);

  await writeTripWeatherHistory('traveller', 'trip-to-delete', [archivedDay]);
  await removeTripOfflineData('traveller', 'trip-to-delete');
  expect(await readTripWeatherHistory('traveller', 'trip-to-delete')).toEqual([archivedDay]);

  await removeTripOfflineData('traveller', 'trip-to-delete', { discardPendingMutations: true });
  expect(await readTripWeatherHistory('traveller', 'trip-to-delete')).toEqual([]);

  await writeTripWeatherHistory('traveller', 'another-trip', [archivedDay]);
  await clearAllOfflineTripData();
  expect(await readTripWeatherHistory('traveller', 'another-trip')).toEqual([]);
});
