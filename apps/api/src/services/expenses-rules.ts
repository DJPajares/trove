import { isValidIanaTimeZone } from './trip-rules.js';

export type ExpenseTimeZoneResolution = {
  source: 'ITINERARY_DAY' | 'ITINERARY_ITEM' | 'TRIP_PLACE' | 'TRIP_REFERENCE';
  timeZone: string;
};

/**
 * The date an expense should record when it names a scheduled itinerary item.
 * A date given explicitly always wins - the item's own day only fills in when
 * nobody separately named a date for the expense itself.
 */
export function preferExplicitLocalDate(
  explicitLocalDate: string | null,
  scheduledItemLocalDate: string | null,
): string | null {
  return explicitLocalDate ?? scheduledItemLocalDate;
}

export function resolveExpenseTimeZone(input: {
  itineraryDayTimeZone: string | null;
  itineraryItemTimeZone: string | null;
  tripPlaceTimeZone: string | null;
  tripTimeZone: string;
}): ExpenseTimeZoneResolution {
  if (input.itineraryItemTimeZone && isValidIanaTimeZone(input.itineraryItemTimeZone)) {
    return { source: 'ITINERARY_ITEM', timeZone: input.itineraryItemTimeZone };
  }

  if (input.tripPlaceTimeZone && isValidIanaTimeZone(input.tripPlaceTimeZone)) {
    return { source: 'TRIP_PLACE', timeZone: input.tripPlaceTimeZone };
  }

  if (input.itineraryDayTimeZone && isValidIanaTimeZone(input.itineraryDayTimeZone)) {
    return { source: 'ITINERARY_DAY', timeZone: input.itineraryDayTimeZone };
  }

  return { source: 'TRIP_REFERENCE', timeZone: input.tripTimeZone };
}

type CurrencyAmount = { amount: { toFixed: (precision: number) => string }; currencyCode: string };

function toCents(amount: CurrencyAmount['amount']) {
  const [whole, fractional = ''] = amount.toFixed(2).split('.');
  return BigInt(`${whole}${fractional.padEnd(2, '0')}`);
}

function fromCents(cents: bigint) {
  const sign = cents < 0n ? '-' : '';
  const normalized = cents < 0n ? -cents : cents;
  const value = normalized.toString().padStart(3, '0');
  return `${sign}${value.slice(0, -2)}.${value.slice(-2)}`;
}

export function totalByCurrency(values: CurrencyAmount[]) {
  const totals = new Map<string, bigint>();

  for (const value of values) {
    const currencyCode = value.currencyCode.trim().toUpperCase();
    totals.set(currencyCode, (totals.get(currencyCode) ?? 0n) + toCents(value.amount));
  }

  return [...totals.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, amount]) => ({ amount: fromCents(amount), currencyCode }));
}

export function projectedCostTotals(input: {
  itineraryItems: Array<{
    id: string;
    plannedCostAmount: { toFixed: (precision: number) => string } | null;
    plannedCostCurrencyCode: string | null;
  }>;
  reservations: Array<{
    itineraryItemId: string | null;
    plannedCostAmount: { toFixed: (precision: number) => string } | null;
    plannedCostCurrencyCode: string | null;
  }>;
}) {
  const reservationLinkedItemIds = new Set(
    input.reservations
      .filter(
        (reservation) =>
          reservation.itineraryItemId &&
          reservation.plannedCostAmount &&
          reservation.plannedCostCurrencyCode,
      )
      .map((reservation) => reservation.itineraryItemId),
  );
  const values: CurrencyAmount[] = [];

  for (const item of input.itineraryItems) {
    if (
      item.plannedCostAmount &&
      item.plannedCostCurrencyCode &&
      !reservationLinkedItemIds.has(item.id)
    ) {
      values.push({ amount: item.plannedCostAmount, currencyCode: item.plannedCostCurrencyCode });
    }
  }

  for (const reservation of input.reservations) {
    if (reservation.plannedCostAmount && reservation.plannedCostCurrencyCode) {
      values.push({
        amount: reservation.plannedCostAmount,
        currencyCode: reservation.plannedCostCurrencyCode,
      });
    }
  }

  return totalByCurrency(values);
}
