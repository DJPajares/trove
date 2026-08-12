import assert from 'node:assert/strict';
import test from 'node:test';

import type { Itinerary, ItineraryItem, ItineraryTripPlace } from '../lib/itinerary/api.ts';
import { buildItineraryMapPoints } from '../lib/maps/itinerary-map.ts';

function tripPlace(
  id: string,
  location: { latitude: number; longitude: number } | null,
): ItineraryTripPlace {
  return {
    id,
    place: {
      id: `place-${id}`,
      kind: 'custom',
      location: location ? { ...location, timeZone: 'Pacific/Auckland' } : null,
      name: id,
      note: null,
      providerRefs: [],
      timeZone: 'Pacific/Auckland',
    },
  };
}

function item(id: string, place: ItineraryTripPlace | null): ItineraryItem {
  return {
    createdAt: '2026-08-12T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day-1',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    tripPlace: place,
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
}

test('builds ordered scheduled markers and distinct considered markers', () => {
  const museum = tripPlace('museum', { latitude: -36.8485, longitude: 174.7633 });
  const park = tripPlace('park', { latitude: -36.8523, longitude: 174.7678 });
  const locationless = tripPlace('locationless', null);
  const museumItem = item('museum-item', museum);
  const duplicateMuseumItem = item('museum-lunch', museum);
  const parkIdea = { ...item('park-idea', park), itineraryDayId: null };
  const itinerary = {
    tripPlaces: [museum, park, locationless],
    unscheduledItems: [parkIdea],
  } as Pick<Itinerary, 'tripPlaces' | 'unscheduledItems'>;

  const points = buildItineraryMapPoints({
    itinerary,
    resolveItemName: (value) => value.customLabel ?? '',
    resolvePlaceName: (value) => value.place.name ?? '',
    selectedDay: { items: [museumItem, duplicateMuseumItem] },
  });

  assert.deepEqual(points, [
    {
      id: 'museum',
      itemId: 'museum-item',
      kind: 'scheduled',
      latitude: -36.8485,
      longitude: 174.7633,
      name: 'museum-item',
      order: 1,
      tripPlaceId: 'museum',
    },
    {
      id: 'park',
      itemId: 'park-idea',
      kind: 'considered',
      latitude: -36.8523,
      longitude: 174.7678,
      name: 'park',
      order: null,
      tripPlaceId: 'park',
    },
  ]);
});

test('returns no markers without a selected day', () => {
  assert.deepEqual(
    buildItineraryMapPoints({
      itinerary: { tripPlaces: [], unscheduledItems: [] },
      resolveItemName: () => '',
      resolvePlaceName: () => '',
      selectedDay: null,
    }),
    [],
  );
});
