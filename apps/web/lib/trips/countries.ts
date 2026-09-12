import { COUNTRY_CODES, countryFlagEmoji } from '@trove/types/countries';

export type NamedCountry = { code: string; flag: string; name: string };

/**
 * Whether Trove recognises a country code at all.
 *
 * The guard has to come before `Intl.DisplayNames`, not after: CLDR answers an
 * unrecognised region with "Unknown Region" rather than with nothing, so a
 * typo'd code would otherwise be shown to a traveller as if it were a place.
 */
export function isKnownCountry(code: string | undefined): code is string {
  return Boolean(code) && COUNTRY_CODES.includes(code as string);
}

/**
 * The countries a trip visits, named and flagged, in the order they were
 * picked.
 *
 * A plain function rather than part of `TripCountries` so the shared itinerary
 * can say where a trip goes without becoming a client component - that page
 * ships no JavaScript, and a flag and a country name are not worth breaking
 * that for.
 *
 * Names come from `Intl.DisplayNames` in the reader's own language, the same
 * source the country picker draws on, so the name a traveller chose from is the
 * name they are shown afterwards. A code that resolves to nothing is dropped
 * rather than rendered as itself.
 */
export function namedCountries(
  countries: readonly string[] | undefined,
  locale: string,
): NamedCountry[] {
  if (!countries?.length) return [];

  let displayNames: Intl.DisplayNames;
  try {
    displayNames = new Intl.DisplayNames(locale, { type: 'region' });
  } catch {
    return [];
  }

  return countries.flatMap((code) => {
    if (!isKnownCountry(code)) return [];
    const name = displayNames.of(code);

    return name && name !== code ? [{ code, flag: countryFlagEmoji(code), name }] : [];
  });
}

/**
 * The countries a trip visits as one line - "🇯🇵 Japan · 🇰🇷 South Korea".
 *
 * For the surfaces that have a single string slot rather than room for markup.
 * Empty means the trip named no country Trove recognises, which is what every
 * trip created before the field existed will say.
 */
export function namedCountryLine(
  countries: readonly string[] | undefined,
  locale: string,
): string | null {
  const named = namedCountries(countries, locale);

  return named.length ? named.map(({ flag, name }) => `${flag} ${name}`).join(' · ') : null;
}
