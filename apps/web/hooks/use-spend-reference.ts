'use client';

import { usePreferences } from '@/components/preferences-provider';
import { useRateBoard, type RateBoardState } from '@/hooks/use-rate-board';
import type { CachedCurrencyRateBoard } from '@/lib/currency/api';
import type { CurrencyTotal } from '@/lib/expenses/api';
import { resolveReferenceCurrency, type ReferenceCurrency } from '@/lib/expenses/spend-insights';

export type SpendReference = {
  board: CachedCurrencyRateBoard | null;
  boardStatus: RateBoardState['status'];
  reference: ReferenceCurrency | null;
};

/**
 * The one currency a trip's figures are expressed in, for every surface that
 * shows them.
 *
 * The panel and the breakdowns have to agree about this: a headline in euro over
 * bars in yen would be two answers to the same question. Resolving it once here
 * is what keeps them from drifting, and react-query collapses the board into a
 * single request no matter how many callers ask.
 */
export function useSpendReference(
  actualSpend: readonly CurrencyTotal[],
  budget: CurrencyTotal | null,
): SpendReference {
  const { preferredCurrency } = usePreferences();

  // A trip spent entirely in one currency needs no rates, and asking for them
  // anyway would bill a request to answer a question with no conversion in it.
  const spendCurrencies = new Set(actualSpend.map((total) => total.currencyCode));
  if (budget) spendCurrencies.add(budget.currencyCode);
  const provisionalReference = preferredCurrency ?? budget?.currencyCode ?? null;
  const needsRates = ![...spendCurrencies].every((code) => code === provisionalReference);
  const { board, status: boardStatus } = useRateBoard(needsRates);

  const canPrice = (code: string) =>
    !board || code === board.base || Boolean(board.rates[code]) || !needsRates;

  return {
    board,
    boardStatus,
    reference: resolveReferenceCurrency({
      budgetCurrency: budget?.currencyCode ?? null,
      canPrice,
      homeCurrency: preferredCurrency,
      totals: actualSpend,
    }),
  };
}
