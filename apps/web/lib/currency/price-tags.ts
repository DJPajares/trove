import type { CurrencyPair } from '@/lib/currency/recent-pairs';

const MULTIPLES = [5, 10, 20, 50, 100, 200] as const;

/**
 * The currency a traveller sees on price tags: whichever half of the pair is
 * not their own. With no home set, or neither half home, it is the target.
 */
export function priceTagCurrency(pair: CurrencyPair, homeCurrency: string | null): string {
  if (homeCurrency && pair.target === homeCurrency && pair.source !== homeCurrency) {
    return pair.source;
  }
  return pair.target;
}

/**
 * Round local amounts worth knowing by heart, scaled so the smallest is a few
 * units of the other currency: ¥500 … ¥20,000 against euros, ₫50,000 … ₫2M
 * against Singapore dollars. Empty when the rate cannot be used.
 */
export function priceTagSteps(localPerOther: number): number[] {
  if (!Number.isFinite(localPerOther) || localPerOther <= 0) return [];
  const magnitude = 10 ** Math.floor(Math.log10(localPerOther));
  return MULTIPLES.map((multiple) => Number((multiple * magnitude).toPrecision(12)));
}
