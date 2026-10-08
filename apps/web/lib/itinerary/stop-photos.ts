import type { ItineraryItem } from './api';
import { resolvePlacePhotoName } from '@/lib/trip-places/place-name';
import {
  editorialSubjectKey,
  type EditorialImageReference,
  type EditorialSubject,
} from '@/lib/media/editorial-images';

function stopPhotoSubject(item: ItineraryItem): EditorialSubject | null {
  const place = item.tripPlace;
  const name = place ? resolvePlacePhotoName(place) : null;
  return place && name
    ? { category: place.place.snapshot?.category, name, placeId: place.place.id }
    : null;
}

/** Only linked Places near the viewport; neither captions nor nicknames identify a photo. */
export function plannerStopPhotoSubjects(
  items: readonly ItineraryItem[],
  visibleIds: ReadonlySet<string>,
) {
  const subjects = new Map<string, EditorialSubject>();
  for (const item of items) {
    if (!visibleIds.has(item.id)) continue;
    const subject = stopPhotoSubject(item);
    if (subject) subjects.set(editorialSubjectKey(subject), subject);
  }
  return [...subjects.values()];
}

/** A thumbnail must picture the Place itself, rather than a category or area. */
export function plannerStopPhoto(
  item: ItineraryItem,
  images: ReadonlyMap<string, EditorialImageReference[]>,
) {
  const subject = stopPhotoSubject(item);
  const photo = subject ? images.get(editorialSubjectKey(subject))?.[0] : null;
  return photo?.matchKind === 'exact' ? photo : null;
}
