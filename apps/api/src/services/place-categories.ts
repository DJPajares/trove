import type { TrovePlaceCategory } from './places.js';

const DESTINATION_TYPES = new Set([
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'administrative_area_level_6',
  'administrative_area_level_7',
  'archipelago',
  'colloquial_area',
  'continent',
  'country',
  'locality',
  'neighborhood',
  'postal_code',
  'sublocality',
]);

const THINGS_TO_DO_TYPES = new Set([
  'amusement_center',
  'amusement_park',
  'aquarium',
  'art_gallery',
  'beach',
  'botanical_garden',
  'cultural_center',
  'event_venue',
  'historical_landmark',
  'marina',
  'monument',
  'museum',
  'national_park',
  'night_club',
  'park',
  'performing_arts_theater',
  'stadium',
  'tourist_attraction',
  'visitor_center',
  'zoo',
]);

const FOOD_AND_DRINK_TYPES = new Set([
  'bakery',
  'bar',
  'cafe',
  'coffee_shop',
  'food',
  'food_court',
  'ice_cream_shop',
  'meal_delivery',
  'meal_takeaway',
  'restaurant',
  'winery',
]);

/** Google types for somewhere to sleep. */
export const STAY_TYPES: ReadonlySet<string> = new Set([
  'bed_and_breakfast',
  'campground',
  'camping_cabin',
  'cottage',
  'extended_stay_hotel',
  'farmstay',
  'guest_house',
  'hostel',
  'hotel',
  'lodging',
  'motel',
  'private_guest_room',
  'resort_hotel',
  'rv_park',
]);

const SHOPPING_TYPES = new Set([
  'department_store',
  'discount_store',
  'flea_market',
  'grocery_store',
  'market',
  'shopping_mall',
  'store',
  'supermarket',
]);

const TRANSPORT_TYPES = new Set([
  'airport',
  'bus_station',
  'bus_stop',
  'car_rental',
  'ferry_terminal',
  'gas_station',
  'heliport',
  'light_rail_station',
  'parking',
  'park_and_ride',
  'subway_station',
  'taxi_stand',
  'train_station',
  'transit_depot',
  'transit_station',
  'transportation_service',
  'truck_stop',
]);

function mapPlaceType(type: string): TrovePlaceCategory | null {
  if (DESTINATION_TYPES.has(type)) {
    return 'destination';
  }

  if (THINGS_TO_DO_TYPES.has(type)) {
    return 'things_to_do';
  }

  if (FOOD_AND_DRINK_TYPES.has(type) || type.endsWith('_restaurant')) {
    return 'food_and_drink';
  }

  if (STAY_TYPES.has(type)) {
    return 'stay';
  }

  if (SHOPPING_TYPES.has(type) || type.endsWith('_store')) {
    return 'shopping';
  }

  if (TRANSPORT_TYPES.has(type)) {
    return 'transport';
  }

  return null;
}

/**
 * Every Trove category a provider's types describe, the primary type's first,
 * each once - a hotel with a restaurant is a stay and food and drink. `other`
 * only when nothing matched. Provider type names stop here: callers see Trove
 * categories and nothing else.
 */
export function placeTypeCategories(
  rawTypes: readonly string[],
  primaryType?: string | null,
): TrovePlaceCategory[] {
  const orderedTypes = primaryType
    ? [primaryType, ...rawTypes.filter((type) => type !== primaryType)]
    : rawTypes;
  const categories: TrovePlaceCategory[] = [];
  for (const type of orderedTypes) {
    const category = mapPlaceType(type);
    if (category && !categories.includes(category)) categories.push(category);
  }
  return categories.length ? categories : ['other'];
}

/** The one category a surface shows when it can show only one. */
export function categorizePlaceTypes(rawTypes: string[], primaryType?: string | null) {
  return placeTypeCategories(rawTypes, primaryType)[0] ?? ('other' satisfies TrovePlaceCategory);
}

type DbPlaceCategory =
  'DESTINATION' | 'FOOD_AND_DRINK' | 'OTHER' | 'SHOPPING' | 'STAY' | 'THINGS_TO_DO' | 'TRANSPORT';

/** The database spells categories as enum names; everything above it uses Trove's words. */
export function categoriesFromDb(
  values: readonly string[] | null | undefined,
): TrovePlaceCategory[] {
  return (values ?? []).map((value) => value.toLowerCase() as TrovePlaceCategory);
}

export function categoriesToDb(values: readonly TrovePlaceCategory[]): DbPlaceCategory[] {
  return [...new Set(values)].map((value) => value.toUpperCase() as DbPlaceCategory);
}

/**
 * What a place is, all told: what its provider types say, plus what the
 * traveller added for the place itself or for this trip. Additions never take
 * a derived category away, and `other` stands only when nothing else does.
 */
export function effectiveCategories(
  derived: readonly TrovePlaceCategory[],
  ...added: ReadonlyArray<readonly TrovePlaceCategory[]>
): TrovePlaceCategory[] {
  const all = [...new Set([...derived, ...added.flat()])].filter(
    (category) => category !== 'other',
  );
  return all.length ? all : ['other'];
}
