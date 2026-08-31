import type { ItineraryMapPoint } from '@/lib/maps/itinerary-map';

import type { AiPlanningDraft, AiPlanningDraftItem } from './api';

/**
 * A review draft can contain free-text Custom Places. Only a verified provider
 * identity with provider-supplied coordinates earns a map marker, so the map
 * never turns a guessed or traveller-entered place into a false location.
 */
export function buildAiPlanningReviewMapPoints(draft: AiPlanningDraft): ItineraryMapPoint[] {
  const itemByPlace = new Map<string, { item: AiPlanningDraftItem; order: number }>();
  let order = 1;
  for (const item of [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems]) {
    if (item.placeRefId && !itemByPlace.has(item.placeRefId)) {
      itemByPlace.set(item.placeRefId, { item, order });
    }
    order += 1;
  }

  return draft.places.flatMap((place) => {
    if (place.resolution !== 'verified' || !place.location) return [];
    const entry = itemByPlace.get(place.id);
    return [
      {
        id: place.id,
        itemId: entry?.item.id ?? null,
        kind: entry ? 'scheduled' : 'considered',
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        name: place.name,
        order: entry?.order ?? null,
        tripPlaceId: place.id,
      } satisfies ItineraryMapPoint,
    ];
  });
}
