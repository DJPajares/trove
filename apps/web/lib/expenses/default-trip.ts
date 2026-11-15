import { nextTripForTools } from '@/lib/tools/shelf';

type TripLike = Parameters<typeof nextTripForTools>[0][number];

/**
 * The trip the Expenses page opens on when the address names none: the one
 * underway or the soonest ahead, as Kit works for, else the most recent trip
 * so a traveller between trips still lands on the spending they last had.
 */
export function defaultExpensesTrip<T extends TripLike>(
  trips: readonly T[],
  today: string,
): T | null {
  return (
    nextTripForTools(trips, today) ??
    trips.toSorted((left, right) => right.startDate.localeCompare(left.startDate))[0] ??
    null
  );
}
