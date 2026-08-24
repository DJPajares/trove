import { expect, test } from 'vitest';

import type { Itinerary, ItineraryDay } from '../lib/itinerary/api.ts';
import { applyOfflineMutation } from '../lib/offline/trip-store.ts';

function itinerary(): Itinerary {
  const day: ItineraryDay = {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: '2026-09-05',
    defaultTimeZone: 'Pacific/Auckland',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: 'day',
    items: [],
    name: null,
    notes: 'A note that must remain intact',
    routeStartTravelMode: 'drive',
  };

  return {
    days: [day],
    trip: {
      endDate: '2026-09-05',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Pacific/Auckland',
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems: [],
  };
}

test('offline day-name mutations optimistically update only the matching day', () => {
  const result = applyOfflineMutation(itinerary(), {
    baseName: null,
    itineraryDayId: 'day',
    kind: 'itinerary_day_name',
    name: '  Golden Hour Photography  ',
  });

  expect(result.days[0]).toMatchObject({
    name: 'Golden Hour Photography',
    notes: 'A note that must remain intact',
  });
});

test('offline day-name mutations clear a name with null', () => {
  const source = itinerary();
  source.days[0]!.name = 'Chill Beach Day';

  const result = applyOfflineMutation(source, {
    baseName: 'Chill Beach Day',
    itineraryDayId: 'day',
    kind: 'itinerary_day_name',
    name: null,
  });

  expect(result.days[0]?.name).toBeNull();
});
