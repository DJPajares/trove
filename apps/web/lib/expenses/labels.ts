import type { Expense, ExpensePlace } from '@/lib/expenses/api';

/**
 * A provider Place carries no name of its own in Trove, so without the snapshot
 * every one of them reads as "Unnamed place" and they become impossible to tell
 * apart. Callers pass their own fallback so this stays free of translations.
 */
export function placeLabel(place: ExpensePlace | null, fallback: string): string {
  return place ? (place.name ?? place.snapshot?.name ?? fallback) : fallback;
}

/** An item named only by its Place has no label of its own to fall back on. */
export function itineraryItemLabel(
  item: { label: string | null; place: ExpensePlace | null },
  fallback: string,
): string {
  return item.label ?? placeLabel(item.place, fallback);
}

export function expenseTitle(expense: Pick<Expense, 'title'>, fallback: string): string {
  return expense.title ?? fallback;
}
