import { atlasPickCategory, type AtlasTripPick } from '@/lib/atlas/picks';
import { createCustomPlace } from '@/lib/saved/api';
import { addTripPlace, updateTripPlace } from '@/lib/trip-places/api';

/**
 * Carries Atlas picks into a trip as Custom Places (PRD 40.4): each keeps the
 * listing's name and, where the guide gave them, its coordinates. No Google
 * request runs here, so a guide can never be used to spend provider calls in
 * bulk; the traveller connects any of them later with Locate, one explicit
 * lookup at a time. A pick that fails is skipped rather than failing the trip.
 */
export async function addAtlasPicksToTrip(tripId: string, picks: readonly AtlasTripPick[]) {
  let added = 0;
  for (const pick of picks) {
    try {
      const location =
        pick.latitude !== null && pick.longitude !== null
          ? { latitude: pick.latitude, longitude: pick.longitude }
          : null;
      const { place } = await createCustomPlace({ location, name: pick.name });
      const { tripPlace } = await addTripPlace(tripId, place.id);
      await updateTripPlace(tripId, tripPlace.id, {
        categories: [atlasPickCategory(pick.kind)],
        priority: 'must_go',
      }).catch(() => undefined);
      added += 1;
    } catch {
      // The trip stands without this one; the rest still arrive.
    }
  }
  return { added, failed: picks.length - added };
}
