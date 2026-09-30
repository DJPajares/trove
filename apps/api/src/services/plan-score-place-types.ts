import type { PlanScoreInterval } from './plan-score-factors.js';

/**
 * Reviewed place-type calibration for Plan Score (PRD section 29.1). These are
 * an initial, reproducible product judgment about a *kind* of place, versioned
 * with the rubric: how long a visit usually takes, when it suits a traveller,
 * and which interest it serves. None of it is a claim about a specific venue,
 * so every signal built from it is `ESTIMATED` evidence.
 */

/** A visit length: `typical` fills an unknown duration, `minimum` marks a rushed one. */
export type PlaceVisitMinutes = { typical: number; minimum: number };

/**
 * Local minutes from midnight; an `endMinute` past 1440 runs into the next night.
 * `typicalMinute` is when such a visit usually starts, for suggesting a time; the
 * window's bounds alone decide whether a planned time suits it.
 */
export type PlaceTimeWindow = PlanScoreInterval & { typicalMinute?: number };
export type PlaceTimeWindows = readonly PlaceTimeWindow[] | 'DAYLIGHT';

export type PlaceProfile = {
  /** Logistics places (airports, stations, stays) are never scored as visits. */
  kind: 'visit' | 'logistics';
  visit: PlaceVisitMinutes | null;
  /**
   * When a visit of this kind suits a traveller, or `null` when the kind says
   * nothing about it. `ACCESS` windows only stand in for unknown opening hours.
   */
  windows: PlaceTimeWindows | null;
  windowKind: 'EXPERIENCE' | 'ACCESS' | null;
  outdoor: boolean;
  /** Kinds that commonly close or change hours on a public holiday. */
  holidaySensitive: boolean;
};

const at = (hour: number, minute = 0) => hour * 60 + minute;
const MEALS = [
  { startMinute: at(10, 30), endMinute: at(15, 30), typicalMinute: at(12, 30) },
  { startMinute: at(17), endMinute: at(23), typicalMinute: at(19) },
];
const DAYTIME = [{ startMinute: at(7), endMinute: at(21) }];
const OPENING_DAY = [{ startMinute: at(9), endMinute: at(19) }];
const SHOPPING_DAY = [{ startMinute: at(9), endMinute: at(22) }];

type ProfileRule = { types: readonly string[]; suffix?: string; profile: PlaceProfile };
const visit = (
  typical: number,
  minimum: number,
  windows: PlaceTimeWindows | null,
  options: Partial<Pick<PlaceProfile, 'outdoor' | 'holidaySensitive' | 'windowKind'>> = {},
): PlaceProfile => ({
  kind: 'visit',
  visit: { typical, minimum },
  windows,
  windowKind: windows ? (options.windowKind ?? 'EXPERIENCE') : null,
  outdoor: options.outdoor ?? false,
  holidaySensitive: options.holidaySensitive ?? false,
});
const LOGISTICS: PlaceProfile = {
  kind: 'logistics',
  visit: null,
  windows: null,
  windowKind: null,
  outdoor: false,
  holidaySensitive: false,
};

/**
 * Specific kinds, in priority order. A place usually carries several types, and
 * the first rule any of them matches decides its profile, so a restaurant that
 * is also a `tourist_attraction` is still a restaurant.
 */
const RULES: readonly ProfileRule[] = [
  {
    types: [
      'airport',
      'international_airport',
      'train_station',
      'transit_station',
      'bus_station',
      'subway_station',
      'light_rail_station',
      'ferry_terminal',
      'bus_stop',
      'taxi_stand',
      'parking',
      'car_rental',
      'transportation_service',
      'lodging',
      'hotel',
      'resort_hotel',
      'hostel',
      'motel',
      'bed_and_breakfast',
      'guest_house',
      'inn',
      'extended_stay_hotel',
    ],
    profile: LOGISTICS,
  },
  {
    types: ['breakfast_restaurant', 'brunch_restaurant'],
    profile: visit(60, 25, [{ startMinute: at(6), endMinute: at(14), typicalMinute: at(8, 30) }]),
  },
  {
    types: ['fast_food_restaurant', 'meal_takeaway', 'sandwich_shop', 'food_court'],
    profile: visit(40, 15, MEALS),
  },
  {
    types: ['restaurant', 'bar_and_grill', 'diner'],
    suffix: '_restaurant',
    profile: visit(75, 30, MEALS),
  },
  {
    types: ['cafe', 'coffee_shop', 'tea_house', 'bakery'],
    profile: visit(40, 15, [{ startMinute: at(7), endMinute: at(20) }]),
  },
  {
    types: ['dessert_shop', 'ice_cream_shop', 'juice_shop', 'confectionery', 'chocolate_shop'],
    profile: visit(30, 10, [{ startMinute: at(10), endMinute: at(22, 30) }]),
  },
  {
    types: ['bar', 'pub', 'wine_bar', 'cocktail_bar', 'beer_garden', 'winery'],
    profile: visit(90, 30, [{ startMinute: at(16), endMinute: at(26), typicalMinute: at(19) }]),
  },
  {
    types: ['night_club', 'karaoke', 'casino', 'comedy_club'],
    profile: visit(150, 60, [{ startMinute: at(20), endMinute: at(28), typicalMinute: at(22) }]),
  },
  {
    types: ['market', 'farmers_market', 'flea_market', 'night_market'],
    profile: visit(75, 30, [{ startMinute: at(6), endMinute: at(23) }], {
      holidaySensitive: true,
    }),
  },
  {
    types: ['shopping_mall', 'department_store', 'outlet_mall'],
    profile: visit(90, 30, SHOPPING_DAY, { windowKind: 'ACCESS', holidaySensitive: true }),
  },
  {
    types: ['clothing_store', 'gift_shop', 'book_store', 'jewelry_store', 'shoe_store', 'tailor'],
    suffix: '_store',
    profile: visit(45, 15, SHOPPING_DAY, { windowKind: 'ACCESS', holidaySensitive: true }),
  },
  {
    types: ['museum', 'art_museum', 'history_museum', 'science_museum', 'planetarium'],
    profile: visit(120, 60, OPENING_DAY, { windowKind: 'ACCESS', holidaySensitive: true }),
  },
  {
    types: ['art_gallery', 'art_studio', 'cultural_center'],
    profile: visit(60, 30, OPENING_DAY, { windowKind: 'ACCESS', holidaySensitive: true }),
  },
  {
    types: ['zoo', 'amusement_park', 'water_park', 'wildlife_park', 'theme_park'],
    profile: visit(180, 90, [{ startMinute: at(8), endMinute: at(20) }], {
      windowKind: 'ACCESS',
      outdoor: true,
    }),
  },
  {
    types: ['aquarium'],
    profile: visit(120, 60, [{ startMinute: at(8), endMinute: at(20) }], { windowKind: 'ACCESS' }),
  },
  {
    types: [
      'performing_arts_theater',
      'concert_hall',
      'opera_house',
      'movie_theater',
      'event_venue',
      'stadium',
      'arena',
      'auditorium',
    ],
    profile: visit(150, 60, [{ startMinute: at(10), endMinute: at(24) }]),
  },
  {
    types: ['spa', 'wellness_center', 'massage', 'sauna', 'public_bath'],
    profile: visit(90, 45, [{ startMinute: at(8), endMinute: at(23) }]),
  },
  {
    types: ['hiking_area', 'national_park', 'state_park', 'nature_preserve'],
    profile: visit(150, 60, 'DAYLIGHT', { outdoor: true }),
  },
  { types: ['beach'], profile: visit(120, 45, 'DAYLIGHT', { outdoor: true }) },
  {
    types: [
      'ski_resort',
      'golf_course',
      'marina',
      'sports_activity_location',
      'adventure_sports_center',
    ],
    profile: visit(120, 60, 'DAYLIGHT', { outdoor: true }),
  },
  {
    types: ['park', 'garden', 'botanical_garden', 'picnic_ground', 'city_park', 'dog_park'],
    profile: visit(60, 20, 'DAYLIGHT', { outdoor: true }),
  },
  {
    types: ['scenic_spot', 'natural_feature', 'waterfall', 'viewpoint'],
    profile: visit(30, 10, 'DAYLIGHT', { outdoor: true }),
  },
  {
    types: ['observation_deck'],
    profile: visit(45, 15, [{ startMinute: at(9), endMinute: at(23) }]),
  },
  {
    types: [
      'church',
      'mosque',
      'hindu_temple',
      'buddhist_temple',
      'shinto_shrine',
      'synagogue',
      'place_of_worship',
    ],
    profile: visit(45, 15, [{ startMinute: at(6), endMinute: at(19) }], { windowKind: 'ACCESS' }),
  },
  {
    types: [
      'historical_landmark',
      'historical_place',
      'monument',
      'cultural_landmark',
      'sculpture',
      'castle',
      'plaza',
      'bridge',
    ],
    profile: visit(45, 15, DAYTIME),
  },
  {
    types: [
      'neighborhood',
      'locality',
      'sublocality',
      'sublocality_level_1',
      'sublocality_level_2',
      'colloquial_area',
      'route',
    ],
    profile: visit(120, 45, [{ startMinute: at(7), endMinute: at(23) }]),
  },
  // Generic kinds last: they only speak for a place nothing more specific describes.
  { types: ['tourist_attraction', 'visitor_center'], profile: visit(60, 20, DAYTIME) },
];

/** Reviewed semantic mappings, not an inferred preference from selecting a Place. */
const TYPE_INTERESTS: Record<string, readonly string[]> = {
  museum: ['art_museums'],
  art_museum: ['art_museums'],
  art_gallery: ['art_museums'],
  art_studio: ['art_museums'],
  history_museum: ['culture_history'],
  historical_landmark: ['culture_history', 'architecture'],
  cultural_landmark: ['culture_history'],
  cultural_center: ['culture_history'],
  historical_place: ['culture_history'],
  monument: ['culture_history', 'architecture'],
  castle: ['culture_history', 'architecture'],
  buddhist_temple: ['culture_history', 'architecture'],
  hindu_temple: ['culture_history', 'architecture'],
  shinto_shrine: ['culture_history', 'architecture'],
  mosque: ['culture_history', 'architecture'],
  church: ['culture_history', 'architecture'],
  synagogue: ['culture_history', 'architecture'],
  place_of_worship: ['culture_history'],
  national_park: ['nature_scenery', 'outdoor_activities'],
  state_park: ['nature_scenery', 'outdoor_activities'],
  nature_preserve: ['nature_scenery'],
  park: ['nature_scenery', 'outdoor_activities'],
  botanical_garden: ['nature_scenery'],
  garden: ['nature_scenery'],
  picnic_ground: ['nature_scenery'],
  scenic_spot: ['nature_scenery'],
  natural_feature: ['nature_scenery'],
  waterfall: ['nature_scenery'],
  observation_deck: ['nature_scenery'],
  zoo: ['nature_scenery'],
  aquarium: ['nature_scenery'],
  wildlife_park: ['nature_scenery'],
  hiking_area: ['nature_scenery', 'outdoor_activities'],
  beach: ['nature_scenery', 'outdoor_activities'],
  marina: ['outdoor_activities'],
  ski_resort: ['outdoor_activities'],
  golf_course: ['outdoor_activities'],
  sports_activity_location: ['outdoor_activities'],
  adventure_sports_center: ['outdoor_activities'],
  restaurant: ['food_drink'],
  cafe: ['food_drink'],
  coffee_shop: ['food_drink'],
  tea_house: ['food_drink'],
  bakery: ['food_drink'],
  dessert_shop: ['food_drink'],
  food_court: ['food_drink'],
  winery: ['food_drink'],
  market: ['shopping'],
  night_market: ['shopping', 'food_drink'],
  shopping_mall: ['shopping'],
  department_store: ['shopping'],
  clothing_store: ['shopping'],
  gift_shop: ['shopping'],
  tailor: ['shopping'],
  night_club: ['entertainment_nightlife'],
  karaoke: ['entertainment_nightlife'],
  casino: ['entertainment_nightlife'],
  comedy_club: ['entertainment_nightlife'],
  bar: ['food_drink', 'entertainment_nightlife'],
  pub: ['food_drink', 'entertainment_nightlife'],
  wine_bar: ['food_drink', 'entertainment_nightlife'],
  performing_arts_theater: ['entertainment_nightlife', 'art_museums'],
  concert_hall: ['entertainment_nightlife'],
  opera_house: ['entertainment_nightlife', 'art_museums'],
  spa: ['wellness_relaxation'],
  wellness_center: ['wellness_relaxation'],
  massage: ['wellness_relaxation'],
  sauna: ['wellness_relaxation'],
  public_bath: ['wellness_relaxation'],
};

export const interestsForPlaceTypes = (types: readonly string[]) => [
  ...new Set(
    types.flatMap(
      (type) => TYPE_INTERESTS[type] ?? (type.endsWith('_restaurant') ? ['food_drink'] : []),
    ),
  ),
];

const matches = (rule: ProfileRule, type: string) =>
  rule.types.includes(type) || (rule.suffix !== undefined && type.endsWith(rule.suffix));

/** The reviewed profile for a place's types, or `null` for a kind Trove has not reviewed. */
export function placeProfile(types: readonly string[] | null | undefined): PlaceProfile | null {
  if (!types?.length) return null;
  for (const rule of RULES) if (types.some((type) => matches(rule, type))) return rule.profile;
  return null;
}
