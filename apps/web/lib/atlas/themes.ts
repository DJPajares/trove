import type { AtlasCountry } from './index';

export const ATLAS_THEMES = ['food', 'nature', 'cities', 'coast', 'festivals'] as const;
export type AtlasTheme = (typeof ATLAS_THEMES)[number];

export type AtlasThemeDefinition = {
  /** Curated ISO 3166-1 alpha-2 country codes in display order. */
  countryCodes: readonly string[];
  id: AtlasTheme;
  /** Matching Wikivoyage travel-topic article title (CC BY-SA 4.0). */
  wikivoyageTopic: string;
};

/**
 * Curated browsing themes for Atlas's "What" tab (PRD 40.2).
 *
 * Every entry resolves against the already-loaded Atlas country index so
 * browsing themes never triggers per-row climate, guide, or Google requests
 * (PRD 40.6).
 */
export const ATLAS_THEME_DEFINITIONS: Record<AtlasTheme, AtlasThemeDefinition> = {
  food: {
    countryCodes: [
      'JP',
      'IT',
      'TH',
      'MX',
      'FR',
      'VN',
      'IN',
      'ES',
      'KR',
      'PE',
      'MA',
      'GR',
      'TR',
      'PH',
      'MY',
      'SG',
    ],
    id: 'food',
    wikivoyageTopic: 'Culinary travel',
  },
  nature: {
    countryCodes: [
      'IS',
      'NZ',
      'CA',
      'NO',
      'CR',
      'CH',
      'PE',
      'ZA',
      'AU',
      'KE',
      'TZ',
      'CL',
      'NP',
      'AR',
      'US',
      'ID',
    ],
    id: 'nature',
    wikivoyageTopic: 'National parks',
  },
  cities: {
    countryCodes: [
      'JP',
      'FR',
      'GB',
      'US',
      'IT',
      'ES',
      'DE',
      'KR',
      'SG',
      'NL',
      'AT',
      'CZ',
      'PT',
      'HK',
      'TR',
      'AE',
    ],
    id: 'cities',
    wikivoyageTopic: 'Urban exploration',
  },
  coast: {
    countryCodes: [
      'GR',
      'PH',
      'TH',
      'HR',
      'PT',
      'IT',
      'ES',
      'ID',
      'AU',
      'MX',
      'CR',
      'LK',
      'TR',
      'MA',
      'NZ',
      'BR',
    ],
    id: 'coast',
    wikivoyageTopic: 'Beaches',
  },
  festivals: {
    countryCodes: [
      'JP',
      'BR',
      'IN',
      'ES',
      'MX',
      'TH',
      'PH',
      'DE',
      'IT',
      'IE',
      'CN',
      'KR',
      'MA',
      'PE',
      'FR',
      'GB',
    ],
    id: 'festivals',
    wikivoyageTopic: 'Festivals',
  },
};

/**
 * Returns the countries matching a theme from the loaded Atlas index, in
 * curated order, skipping any country code not present in the index.
 */
export function countriesForTheme(
  countries: readonly AtlasCountry[],
  theme: AtlasTheme,
): AtlasCountry[] {
  const byCode = new Map(countries.map((country) => [country.countryCode, country]));
  const result: AtlasCountry[] = [];
  for (const code of ATLAS_THEME_DEFINITIONS[theme].countryCodes) {
    const match = byCode.get(code);
    if (match) result.push(match);
  }
  return result;
}

/**
 * Picks a random country from the loaded Atlas index for "Surprise me"
 * (PRD 40.2). Returns null when the index is empty.
 */
export function pickSurpriseCountry(
  countries: readonly AtlasCountry[],
  random: () => number = Math.random,
): AtlasCountry | null {
  if (!countries.length) return null;
  const raw = random();
  const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999999999) : 0;
  return countries[Math.floor(clamped * countries.length)] ?? countries[0] ?? null;
}
