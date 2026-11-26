/**
 * Atlas, the destination guide (PRD 40).
 *
 * Guide text is Wikivoyage's (CC BY-SA 4.0), adapted into Trove's own reading
 * layout as plain text: no source markup ever reaches a client. Countries,
 * their twelve-month patterns and their guides are shared reference data,
 * stored permanently in Trove's database and served by the API.
 */

export const ATLAS_REGIONS = ['africa', 'americas', 'asia', 'europe', 'oceania'] as const;
export type AtlasRegion = (typeof ATLAS_REGIONS)[number];

export const ATLAS_MONTH_RATINGS = ['great', 'good', 'mixed', 'off'] as const;
export type AtlasMonthRating = (typeof ATLAS_MONTH_RATINGS)[number];

/** One calendar month's typical conditions at a country's representative city. */
export type AtlasMonthClimate = {
  /** 1 to 12. */
  month: number;
  temperatureMaxC: number;
  temperatureMinC: number;
  /** Share of days with at least 1 mm of rain, 0 to 1. */
  wetDayShare: number;
  rating: AtlasMonthRating;
};

export type AtlasIndexEntry = {
  /** ISO 3166-1 alpha-2. Names come from `Intl.DisplayNames` in the reader's locale. */
  countryCode: string;
  region: AtlasRegion;
  /** The English Wikivoyage article this country's guide is read from. */
  wikivoyageTitle: string;
  /** Where the typical conditions are measured: the main city a traveller arrives in. */
  climateCity: string;
  latitude: number;
  longitude: number;
  /** Twelve months, January first, or null where no pattern could be built. */
  months: AtlasMonthClimate[] | null;
};

/** What `GET /atlas/countries` answers. */
export type AtlasIndex = {
  /** The complete calendar years the patterns average, when any country has one. */
  climateYears: { from: number; to: number } | null;
  countries: AtlasIndexEntry[];
};

/** One month's typical conditions as stored, before a rating is derived. */
export type AtlasClimateNorm = Omit<AtlasMonthClimate, 'rating'>;

/** Rates each month against the place's own driest month (see `atlasMonthRating`). */
export function rateAtlasClimate(norms: readonly AtlasClimateNorm[]): AtlasMonthClimate[] {
  const driest = Math.min(...norms.map((norm) => norm.wetDayShare));
  return norms.map((norm) => ({ ...norm, rating: atlasMonthRating(norm, driest) }));
}

export const ATLAS_LISTING_KINDS = [
  'see',
  'do',
  'buy',
  'eat',
  'drink',
  'sleep',
  'go',
  'listing',
] as const;
export type AtlasListingKind = (typeof ATLAS_LISTING_KINDS)[number];

/** A Wikivoyage listing: one sight, restaurant, hotel or the like. */
export type AtlasListing = {
  kind: AtlasListingKind;
  name: string;
  alt: string | null;
  content: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type AtlasBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'listing'; listing: AtlasListing };

export type AtlasSection = {
  /** Stable within one guide: the heading in lower-kebab-case. */
  id: string;
  title: string;
  blocks: AtlasBlock[];
};

export type AtlasDestinationKind = 'city' | 'destination' | 'region';

/** A linked Wikivoyage destination extracted from a country guide (e.g. Bohol, Siargao). */
export type AtlasLinkedDestination = {
  /** URL-safe slug within the country (e.g. "bohol", "el-nido"). */
  slug: string;
  /** Exact Wikivoyage article title used to fetch the sub-guide. */
  wikivoyageTitle: string;
  /** Display name shown on the Places to Explore card. */
  name: string;
  kind: AtlasDestinationKind;
  /** Short teaser from the parent country article, when present. */
  summary: string | null;
};

export type AtlasGuide = {
  countryCode: string;
  /** Empty string for the country root guide; destination slug for sub-guides. */
  slug?: string;
  /** The Wikivoyage article title, for the required credit. */
  title: string;
  revisionId: number;
  /** ISO timestamp of the stored snapshot. Internal freshness, not for display. */
  fetchedAt: string;
  /** The article's opening paragraphs, before its first section. */
  lead: string[];
  sections: AtlasSection[];
  /** Linked cities, iconic destinations, and regions extracted from the country guide. */
  destinations?: AtlasLinkedDestination[];
};

export const ATLAS_LICENCE = {
  name: 'CC BY-SA 4.0',
  url: 'https://creativecommons.org/licenses/by-sa/4.0/',
} as const;

export function wikivoyageArticleUrl(title: string) {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

export function wikivoyageHistoryUrl(title: string) {
  return `https://en.wikivoyage.org/w/index.php?title=${encodeURIComponent(
    title.replaceAll(' ', '_'),
  )}&action=history`;
}

const ramp = (value: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (value - from) / (to - from)));

/**
 * How good a month typically is for a visit, from the same typical conditions
 * Insights and seasonal fit read (PRD 29.7).
 *
 * Rain is judged against the place's own driest month. The archive counts a
 * wet day from 1 mm, so in the tropics nearly every month looks wet in
 * absolute terms; what a traveller choosing a month needs is the dry season
 * against the wet one. Heat, cool and cold are absolute. It is always a
 * pattern over past years, never a forecast, and says nothing about crowds or
 * prices.
 */
export function atlasMonthRating(
  climate: { temperatureMaxC: number; wetDayShare: number },
  driestWetDayShare: number,
): AtlasMonthRating {
  const wet = ramp(climate.wetDayShare - driestWetDayShare, 0.1, 0.45);
  const heat = ramp(climate.temperatureMaxC, 31, 37);
  const cool = ramp(18 - climate.temperatureMaxC, 0, 14);
  const cold = ramp(5 - climate.temperatureMaxC, 0, 15);
  const score = 100 - 50 * wet - 40 * heat - 40 * cool - 40 * cold;
  if (score >= 85) return 'great';
  if (score >= 70) return 'good';
  if (score >= 50) return 'mixed';
  return 'off';
}
