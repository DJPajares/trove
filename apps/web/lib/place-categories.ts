/**
 * Trove's place taxonomy, mirroring `TROVE_PLACE_CATEGORIES` in the API. The API
 * derives a category on every read rather than storing one, so a place can
 * legitimately arrive without a category at all - a Custom Place never has one -
 * and every consumer here has to accept `undefined` and mean `other` by it.
 */
export const TROVE_PLACE_CATEGORIES = [
  'destination',
  'things_to_do',
  'food_and_drink',
  'stay',
  'shopping',
  'transport',
  'other',
] as const;

export type TrovePlaceCategory = (typeof TROVE_PLACE_CATEGORIES)[number];
