import { z } from 'zod';

/**
 * What kind of place something is, in Trove's own travel words. Provider types
 * are mapped onto these on the server and never travel further, so the app
 * reasons about "a stay" or "food and drink" rather than about Google's
 * vocabulary. A place may be several at once - a hotel with a restaurant.
 */
export const PLACE_CATEGORIES = [
  'destination',
  'things_to_do',
  'food_and_drink',
  'stay',
  'shopping',
  'transport',
  'other',
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const placeCategorySchema = z.enum(PLACE_CATEGORIES);

/** Categories a traveller may set by hand; `other` is only ever the absence of one. */
export const manualPlaceCategoriesSchema = z
  .array(placeCategorySchema.exclude(['other']))
  .max(PLACE_CATEGORIES.length);
