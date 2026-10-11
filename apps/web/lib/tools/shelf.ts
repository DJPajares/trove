import { currencyForCountry } from '@/lib/currency/country-currency';

type TripLike = {
  countries?: readonly string[];
  endDate: string;
  lifecycle: 'active' | 'completed' | 'planning';
  startDate: string;
};

/**
 * The trip the Tools shelf works for: the one underway, or else the soonest
 * still ahead. A finished or past trip needs no rate and no checklist.
 */
export function nextTripForTools<T extends TripLike>(trips: readonly T[], today: string): T | null {
  return (
    trips
      .filter((trip) => trip.lifecycle !== 'completed' && trip.endDate >= today)
      .toSorted((left, right) => left.startDate.localeCompare(right.startDate))[0] ?? null
  );
}

/**
 * The currency worth a glance for a trip: the first of its countries that
 * spends something other than the traveller's own. Null when every country
 * spends their currency, or none is known.
 */
export function tripLocalCurrency(trip: TripLike, homeCurrency: string | null): string | null {
  for (const country of trip.countries ?? []) {
    const currency = currencyForCountry(country);
    if (currency && currency !== homeCurrency) return currency;
  }
  return null;
}

/**
 * The currencies the traveller's trips ahead will need, soonest trip first and
 * each currency once, so a currency picker can offer them before the full list.
 */
export function tripCurrencySuggestions<T extends TripLike>(
  trips: readonly T[],
  homeCurrency: string | null,
  today: string,
  limit = 3,
): Array<{ currency: string; trip: T }> {
  const suggestions: Array<{ currency: string; trip: T }> = [];
  const upcoming = trips
    .filter((trip) => trip.lifecycle !== 'completed' && trip.endDate >= today)
    .toSorted((left, right) => left.startDate.localeCompare(right.startDate));
  for (const trip of upcoming) {
    for (const country of trip.countries ?? []) {
      const currency = currencyForCountry(country);
      if (!currency || currency === homeCurrency) continue;
      if (suggestions.some((entry) => entry.currency === currency)) continue;
      suggestions.push({ currency, trip });
      if (suggestions.length >= limit) return suggestions;
    }
  }
  return suggestions;
}
