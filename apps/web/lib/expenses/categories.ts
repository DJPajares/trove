import {
  BedDouble,
  Compass,
  Landmark,
  ShoppingBag,
  TramFront,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

import type { ExpenseCategory } from '@/lib/expenses/api';

/** An expense with no category still has to sit somewhere in a breakdown. */
export type SpendCategoryKey = ExpenseCategory | 'uncategorised';

/**
 * The order categories are offered in, and ranked in when spending ties.
 *
 * Roughly the order a trip spends in rather than alphabetical, so the chip row
 * in the editor reads as a day rather than as a list.
 */
export const EXPENSE_CATEGORY_ORDER = [
  'food',
  'transport',
  'stay',
  'activities',
  'shopping',
  'other',
] as const satisfies readonly ExpenseCategory[];

type ExpenseCategoryPresentation = {
  Icon: LucideIcon;
  barClassName: string;
};

/**
 * What a category looks like wherever it appears.
 *
 * The icons are the ones the matching place category already uses, so the Food
 * chip in the editor, the Food bar in a breakdown and the Food place card are
 * recognisably the same thing. The tints are theme tokens rather than literal
 * colours because they have to lighten in dark mode; every class string is
 * complete rather than composed, because Tailwind only sees class names it can
 * read in the source.
 *
 * Colour is never the only signal - every surface that uses these also renders
 * the icon and the category's name.
 */
const EXPENSE_CATEGORY_PRESENTATION: Record<ExpenseCategory, ExpenseCategoryPresentation> = {
  activities: { Icon: Landmark, barClassName: 'bg-category-activities' },
  food: { Icon: UtensilsCrossed, barClassName: 'bg-category-food' },
  other: { Icon: Compass, barClassName: 'bg-category-other' },
  shopping: { Icon: ShoppingBag, barClassName: 'bg-category-shopping' },
  stay: { Icon: BedDouble, barClassName: 'bg-category-stay' },
  transport: { Icon: TramFront, barClassName: 'bg-category-transport' },
};

/**
 * An uncategorised expense borrows `other`'s presentation rather than earning a
 * seventh tint: the traveller did not say it was something else, only that they
 * did not say.
 */
export function resolveExpenseCategory(
  category?: ExpenseCategory | null,
): ExpenseCategoryPresentation {
  return EXPENSE_CATEGORY_PRESENTATION[category ?? 'other'];
}
