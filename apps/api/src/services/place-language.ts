/**
 * The language every snapshot is taken in when a caller does not name one.
 * Trove ships a single locale today (`apps/web/i18n/request.ts`), so this is
 * the code essentially every request resolves to.
 */
export const DEFAULT_PLACE_LANGUAGE_CODE = 'en';

/**
 * One string for one language, everywhere.
 *
 * A snapshot is only valid for the language it was taken in, so the language is
 * part of its cache key. That made the *absence* of a language a second key:
 * Plan Score and time suggestions asked for place locations without naming a
 * language and stored `null`, while the itinerary and Trip Mode asked for the
 * same places in `en`. Neither could ever read the other's snapshot, so the two
 * halves of the app took turns re-billing Google for places it had already
 * answered for.
 *
 * Normalising here means an omitted language, `en`, `EN` and `en-us` are one
 * key rather than four. A genuinely different language is still a genuine miss.
 */
export function normalizePlaceLanguageCode(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_PLACE_LANGUAGE_CODE;

  try {
    // Canonicalises case and separators: `en-us` and `EN-US` both become `en-US`.
    return Intl.getCanonicalLocales(trimmed)[0] ?? DEFAULT_PLACE_LANGUAGE_CODE;
  } catch {
    // Not a well-formed tag. Callers are validated upstream, so this is a
    // programming error rather than user input; the default keeps the cache
    // coherent instead of introducing a junk key.
    return DEFAULT_PLACE_LANGUAGE_CODE;
  }
}
