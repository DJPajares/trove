/**
 * The currency pairs a traveller converted lately, kept on this device only:
 * a convenience for the converter's quick picks and the Tools shelf, never
 * part of their account.
 */
export type CurrencyPair = { source: string; target: string };

const recentPairsKey = 'trove:currency-recent-pairs:v1';
export const MAX_RECENT_CURRENCY_PAIRS = 4;

export function isCurrencyCode(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

export function readRecentCurrencyPairs(): CurrencyPair[] {
  if (typeof window === 'undefined') return [];

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(recentPairsKey) ?? 'null');
    if (!Array.isArray(value)) return [];

    return value
      .filter(
        (pair): pair is CurrencyPair =>
          Boolean(pair) &&
          typeof pair === 'object' &&
          isCurrencyCode(String((pair as CurrencyPair).source)) &&
          isCurrencyCode(String((pair as CurrencyPair).target)),
      )
      .slice(0, MAX_RECENT_CURRENCY_PAIRS);
  } catch {
    return [];
  }
}

export function writeRecentCurrencyPairs(pairs: CurrencyPair[]) {
  try {
    window.localStorage.setItem(recentPairsKey, JSON.stringify(pairs));
  } catch {
    // Private browsing or a full quota should not break the converter.
  }
}

/** The converter's address for one pair, so the shelf can open straight onto it. */
export function currencyPairHref(pair: CurrencyPair) {
  return `/tools/currency?${new URLSearchParams({ from: pair.source, to: pair.target })}`;
}
