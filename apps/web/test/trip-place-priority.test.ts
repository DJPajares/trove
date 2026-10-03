import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Itinerary, ItineraryItem, ItineraryTripPlace } from '../lib/itinerary/api';
import { itineraryDayRouteRevision } from '../lib/itinerary/routes';
import { queryKeys } from '../lib/query/keys';
import { updateTripPlace, type TripPlace, type TripPlacesResponse } from '../lib/trip-places/api';
import { setTripPlacePriority } from '../lib/trip-places/priority';

vi.mock('../lib/trip-places/api', () => ({ updateTripPlace: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function fixture(priority: 'must_go' | null = null) {
  const place: ItineraryTripPlace = {
    id: 'place-a',
    priority,
    customName: null,
    note: null,
    place: {
      id: 'canonical-a',
      kind: 'custom',
      name: 'Park',
      note: null,
      providerAddress: null,
      providerLabel: null,
      timeZone: 'UTC',
      location: { latitude: 1, longitude: 2, timeZone: 'UTC' },
      providerRefs: [],
    },
  };
  const other = { ...place, id: 'place-b' };
  const item = (id: string, tripPlace = place) =>
    ({ id, position: 0, tripPlace, priority: 'maybe', travelModeToNext: 'walk' }) as ItineraryItem;
  return {
    trip: {
      id: 'trip-a',
      name: 'Trip',
      startDate: '2026-10-03',
      endDate: '2026-10-04',
      referenceTimeZone: 'UTC',
    },
    tripPlaces: [place, other],
    days: [
      {
        id: 'day-a',
        dailyBaseTripPlaceId: null,
        dailyBaseDepartureTripPlaceId: null,
        items: [item('first'), item('unrelated', other)],
        routeStartTravelMode: 'walk',
      },
      { id: 'day-b', items: [item('repeat')] },
    ],
    unscheduledItems: [item('unscheduled')],
  } as Itinerary;
}

test.each(['must_go', null] as const)(
  'confirmed priority %s synchronizes every occurrence without changing item priority or routes',
  async (priority) => {
    const client = new QueryClient();
    const original = fixture(priority === null ? 'must_go' : null);
    client.setQueryData(queryKeys.itinerary('trip-a'), original);
    client.setQueryData(queryKeys.itinerary('trip-b'), original);
    client.setQueryData(queryKeys.tripPlaces('trip-a'), {
      trip: original.trip,
      tripPlaces: original.tripPlaces,
    } as unknown as TripPlacesResponse);
    client.setQueryData(['itinerary-day-routes', 'trip-a'], { segments: [] });
    client.setQueryData(['trip-weather', 'trip-a'], { weather: [] });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const updated = { ...original.tripPlaces[0], priority } as unknown as TripPlace;
    vi.mocked(updateTripPlace).mockResolvedValue({ tripPlace: updated });

    await setTripPlacePriority(client, 'trip-a', 'place-a', priority);

    expect(updateTripPlace).toHaveBeenCalledWith('trip-a', 'place-a', { priority });
    const next = client.getQueryData<Itinerary>(queryKeys.itinerary('trip-a'))!;
    expect(next.tripPlaces[0]?.priority).toBe(priority);
    for (const item of [...next.days.flatMap((day) => day.items), ...next.unscheduledItems].filter(
      (item) => item.tripPlace?.id === 'place-a',
    )) {
      expect(item.tripPlace?.priority).toBe(priority);
      expect(item.priority).toBe('maybe');
    }
    expect(next.days[0]?.items[1]).toEqual(original.days[0]?.items[1]);
    expect(client.getQueryData(queryKeys.itinerary('trip-b'))).toEqual(original);
    expect(
      client.getQueryData<TripPlacesResponse>(queryKeys.tripPlaces('trip-a'))?.tripPlaces[0]
        ?.priority,
    ).toBe(priority);
    expect(itineraryDayRouteRevision(next.days[0]!)).toBe(
      itineraryDayRouteRevision(original.days[0]!),
    );
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['plan-score', 'trip-a'] });
    expect(client.getQueryState(['itinerary-day-routes', 'trip-a'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['trip-weather', 'trip-a'])?.isInvalidated).toBe(false);
    client.clear();
  },
);

test('failed persistence leaves shared caches and assessments untouched', async () => {
  const client = new QueryClient();
  const original = fixture();
  client.setQueryData(queryKeys.itinerary('trip-a'), original);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  vi.mocked(updateTripPlace).mockRejectedValue(new Error('Unavailable'));
  await expect(setTripPlacePriority(client, 'trip-a', 'place-a', 'must_go')).rejects.toThrow(
    'Unavailable',
  );
  expect(client.getQueryData(queryKeys.itinerary('trip-a'))).toEqual(original);
  expect(invalidate).not.toHaveBeenCalled();
  client.clear();
});

test('editing from a surface without other cached views does not create incomplete entries', async () => {
  const client = new QueryClient();
  vi.mocked(updateTripPlace).mockResolvedValue({
    tripPlace: { id: 'place-a', priority: 'must_go' } as TripPlace,
  });
  await setTripPlacePriority(client, 'trip-a', 'place-a', 'must_go');
  expect(client.getQueryData(queryKeys.itinerary('trip-a'))).toBeUndefined();
  expect(client.getQueryData(queryKeys.tripPlaces('trip-a'))).toBeUndefined();
  client.clear();
});
