import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  now: new Date('2026-10-03T03:00:00Z'),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.query }));
vi.mock('@/components/preferences-provider', () => ({
  usePreferences: () => ({ preferences: { temperatureUnit: 'celsius' } }),
}));
vi.mock('@/hooks/use-traveller-position', () => ({
  useTravellerPosition: () => ({ position: null }),
}));
vi.mock('@/hooks/use-now-tick', () => ({ useNowTick: () => mocks.now }));
const { useTripWeather } = await import('../lib/weather/use-trip-weather.ts');
const { useHereWeather } = await import('../lib/home/use-here-weather.ts');

const daily = {
  date: '2026-10-03',
  temperatureMax: 25,
  temperatureMin: 16,
  weatherCode: 2,
  precipitationProbability: 20,
};
const data = {
  attribution: { label: 'Open-Meteo', url: 'https://open-meteo.com' },
  current: {
    observedAt: '2026-10-03T08:00',
    temperature: 20,
    apparentTemperature: 20,
    weatherCode: 1,
    isDay: true,
  },
  location: { latitude: 35, longitude: 139, timeZone: 'Asia/Tokyo' },
  place: { name: 'Tokyo' },
  forecast: [daily],
  fetchedAt: '2026-10-03T00:00Z',
  days: [{ ...daily, itineraryDayId: 'today', location: { timeZone: 'Asia/Tokyo' } }],
  horizon: { startDate: '2026-10-03', endDate: '2026-10-18' },
  hours: [],
  hoursDate: '2026-10-03',
};
beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockReturnValue({
    data,
    dataUpdatedAt: Date.parse('2026-10-03T03:00Z'),
    error: new Error('offline'),
    isPending: false,
    refetch: vi.fn(),
  });
});
afterEach(() => vi.clearAllMocks());

test('a failed trip refresh retains forecasts and its error state without changing request policy', () => {
  expect(useTripWeather('trip')).toMatchObject({ status: 'error', data });
  expect(mocks.query.mock.calls[0]![0]).toMatchObject({
    staleTime: 10_800_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });
});
test('Home retains a dated forecast after failed refresh without claiming a timezone city', () => {
  expect(useHereWeather()).toMatchObject({
    status: 'ready',
    weather: { kind: 'forecast', forecast: daily, city: null, fetchedAt: data.fetchedAt },
  });
  expect(mocks.query.mock.calls[0]![0]).toMatchObject({ staleTime: 86_400_000 });
});
test('an error without evidence leaves trip unavailable and Home date-only', () => {
  mocks.query.mockReturnValue({
    data: undefined,
    error: new Error('offline'),
    isPending: false,
    refetch: vi.fn(),
  });
  expect(useTripWeather('trip')).toMatchObject({ data: null, status: 'error' });
  expect(useHereWeather()).toMatchObject({ weather: null, status: 'error' });
});
