import type {
  Itinerary,
  ItineraryDay,
  ItineraryItem,
  ItineraryTripPlace,
} from '@/lib/itinerary/api';

export type ItineraryMapPoint = {
  id: string;
  itemId: string | null;
  kind: 'considered' | 'scheduled';
  latitude: number;
  longitude: number;
  name: string;
  order: number | null;
  tripPlaceId: string;
};

export type ItineraryMapLocation = {
  latitude: number;
  longitude: number;
};

export function buildItineraryMapPoints(input: {
  itinerary: Pick<Itinerary, 'tripPlaces' | 'unscheduledItems'>;
  resolveItemName: (item: ItineraryItem) => string;
  resolvePlaceLocation?: (tripPlace: ItineraryTripPlace) => ItineraryMapLocation | null;
  resolvePlaceName: (tripPlace: ItineraryTripPlace) => string;
  selectedDay: Pick<ItineraryDay, 'items'> | null;
}) {
  if (!input.selectedDay) return [];

  const resolvePlaceLocation =
    input.resolvePlaceLocation ?? ((tripPlace) => tripPlace.place.location);
  const points = new Map<string, ItineraryMapPoint>();
  input.selectedDay.items.forEach((item, index) => {
    const tripPlace = item.tripPlace;
    const location = tripPlace ? resolvePlaceLocation(tripPlace) : null;
    if (!tripPlace || !location || points.has(tripPlace.id)) return;
    points.set(tripPlace.id, {
      id: tripPlace.id,
      itemId: item.id,
      kind: 'scheduled',
      latitude: location.latitude,
      longitude: location.longitude,
      name: input.resolveItemName(item),
      order: index + 1,
      tripPlaceId: tripPlace.id,
    });
  });

  input.itinerary.tripPlaces.forEach((tripPlace) => {
    const location = resolvePlaceLocation(tripPlace);
    if (!location || points.has(tripPlace.id)) return;
    points.set(tripPlace.id, {
      id: tripPlace.id,
      itemId:
        input.itinerary.unscheduledItems.find((item) => item.tripPlace?.id === tripPlace.id)?.id ??
        null,
      kind: 'considered',
      latitude: location.latitude,
      longitude: location.longitude,
      name: input.resolvePlaceName(tripPlace),
      order: null,
      tripPlaceId: tripPlace.id,
    });
  });

  return [...points.values()];
}
