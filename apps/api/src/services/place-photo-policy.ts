/** The existing Place details carousel and bounded evidence cache hold three references. */
export const MAX_PLACE_PHOTOS = 3;

/** Missing configuration preserves behavior; invalid configuration stops new photo spend. */
export function normalizePlacePhotoLimit(limit: number | undefined) {
  if (limit === undefined) return MAX_PLACE_PHOTOS;
  return Number.isInteger(limit) && limit >= 0 && limit <= MAX_PLACE_PHOTOS ? limit : 0;
}

/** Eligibility uses the original cached reference order, never a filtered carousel index. */
export function canFetchPlacePhoto(index: number, limit: number | undefined) {
  return Number.isInteger(index) && index >= 0 && index < normalizePlacePhotoLimit(limit);
}
