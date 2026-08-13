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

export function decodeGooglePolyline(encoded: string): ItineraryMapLocation[] {
  const path: ItineraryMapLocation[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const coordinates: number[] = [];
    for (let coordinateIndex = 0; coordinateIndex < 2; coordinateIndex += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      coordinates.push(result & 1 ? ~(result >> 1) : result >> 1);
    }

    latitude += coordinates[0] ?? 0;
    longitude += coordinates[1] ?? 0;
    path.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return path;
}

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
