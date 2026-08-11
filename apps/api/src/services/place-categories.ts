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

const STAY_TYPES = new Set([
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

export function categorizePlaceTypes(rawTypes: string[], primaryType?: string | null) {
  const orderedTypes = primaryType
    ? [primaryType, ...rawTypes.filter((type) => type !== primaryType)]
    : rawTypes;

  for (const type of orderedTypes) {
    const category = mapPlaceType(type);

    if (category) {
      return category;
    }
  }

  return 'other' satisfies TrovePlaceCategory;
}
