import type { CurrencyTotal, Expense, ExpenseCategory } from '@/lib/expenses/api';

/** Which of the three editors is open, and what it is editing. */
export type EditorState =
  | { kind: 'budget'; expense: null }
  | { kind: 'closed'; expense: null }
  | { kind: 'create'; expense: null }
  | { kind: 'edit'; expense: Expense };

export type ExpenseForm = {
  amount: string;
  category: ExpenseCategory | 'none';
  currencyCode: string;
  itineraryItemId: string;
  localDate: string;
  localTime: string;
  note: string;
  title: string;
  tripPlaceId: string;
};

export type BudgetForm = { amount: string; currencyCode: string };

export function createExpenseForm(
  expense: Expense | null,
  budget: CurrencyTotal | null,
  preferredCurrency: string | null = null,
): ExpenseForm {
  return {
    amount: expense?.amount ?? '',
    category: expense?.category ?? 'none',
    currencyCode: expense?.currencyCode ?? preferredCurrency ?? budget?.currencyCode ?? '',
    itineraryItemId: expense?.itineraryItem?.id ?? 'none',
    localDate: expense?.localDate ?? '',
    localTime: expense?.localTime ?? '',
    note: expense?.note ?? '',
    title: expense?.title ?? '',
    tripPlaceId: expense?.tripPlace?.id ?? 'none',
  };
}

export function createBudgetForm(
  budget: CurrencyTotal | null,
  preferredCurrency: string | null = null,
): BudgetForm {
  return {
    amount: budget?.amount ?? '',
    currencyCode: budget?.currencyCode ?? preferredCurrency ?? '',
  };
}

/** The same shape the API enforces, so an invalid amount never leaves the form. */
export function hasValidMoney(amount: string, currencyCode: string) {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount) && /^[A-Za-z]{3}$/.test(currencyCode);
}
