'use client';

import { Pencil, ReceiptText, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { EditorialSection } from '@/components/editorial-section';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { formatCurrencyAmount } from '@/lib/currency/money';
import type { CurrencyTotal, Expense, ExpensePlace } from '@/lib/expenses/api';
import {
  expenseTitle as resolveExpenseTitle,
  placeLabel as resolvePlaceLabel,
} from '@/lib/expenses/labels';
import { matchesSpendFilter, type SpendFilter } from '@/lib/expenses/spend-insights';

/**
 * Every recorded expense, grouped by the day it belongs to.
 *
 * Amounts here are always the currency the traveller actually paid in. The
 * converted view lives at the top of the screen; a ledger that rewrote what a
 * receipt said would be a worse record than the receipt.
 */
export function ExpenseLedger({
  days,
  expenses,
  filter,
  filterLabel,
  onClearFilter,
  onEdit,
}: Readonly<{
  days: ReadonlyArray<{ actualSpend: CurrencyTotal[]; date: string; id: string }>;
  expenses: readonly Expense[];
  filter: SpendFilter | null;
  /** Names the active filter in the traveller's own words, or null when there is none. */
  filterLabel: string | null;
  onClearFilter: () => void;
  onEdit: (expense: Expense) => void;
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();

  const visible = expenses.filter((expense) => matchesSpendFilter(expense, filter));
  const expensesByDay = new Map<string, Expense[]>();
  const unassignedExpenses: Expense[] = [];
  for (const expense of visible) {
    if (expense.itineraryDay) {
      const values = expensesByDay.get(expense.itineraryDay.id) ?? [];
      values.push(expense);
      expensesByDay.set(expense.itineraryDay.id, values);
    } else {
      unassignedExpenses.push(expense);
    }
  }

  const daySections = days
    .map((day) => ({ ...day, expenses: expensesByDay.get(day.id) ?? [] }))
    .filter((day) => day.expenses.length > 0);

  const money = (total: CurrencyTotal) =>
    formatCurrencyAmount(locale, total.amount, total.currencyCode);
  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const totals = (values: CurrencyTotal[], empty: string) =>
    values.length ? values.map(money).join(', ') : empty;

  const expenseTitle = (expense: Expense) => resolveExpenseTitle(expense, t('untitledExpense'));
  const placeLabel = (place: ExpensePlace | null) => resolvePlaceLabel(place, t('unnamedPlace'));

  /**
   * A day's summary is the sum of what is on screen, not of the whole day - a
   * filtered day showing four expenses under a total covering nine would read as
   * arithmetic the traveller could not follow.
   */
  const daySummary = (day: (typeof daySections)[number]) =>
    filter
      ? totals(
          day.expenses.map((expense) => ({
            amount: expense.amount,
            currencyCode: expense.currencyCode,
          })),
          t('noActualSpend'),
        )
      : totals(day.actualSpend, t('noActualSpend'));

  const renderExpense = (expense: Expense) => (
    <Item className="flex-nowrap px-3 py-3" key={expense.id}>
      <ItemMedia
        className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
        variant="icon"
      >
        <ReceiptText aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <ItemTitle className="min-w-0 truncate text-base">{expenseTitle(expense)}</ItemTitle>
          <span className="shrink-0 text-base font-semibold tabular-nums">
            {money({ amount: expense.amount, currencyCode: expense.currencyCode })}
          </span>
        </div>
        <ItemDescription className="line-clamp-none">
          <span className="flex flex-wrap gap-x-2 gap-y-1">
            {expense.category ? <span>{t(`categories.${expense.category}`)}</span> : null}
            {expense.tripPlace ? <span>{placeLabel(expense.tripPlace)}</span> : null}
            {expense.localDate && !expense.itineraryDay ? <span>{expense.localDate}</span> : null}
          </span>
          {!expense.itineraryDay && expense.localDate ? (
            <span className="mt-1 block">{t('unassignedDatedExpense')}</span>
          ) : null}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <Button
          aria-label={t('editExpense', { title: expenseTitle(expense) })}
          onClick={() => onEdit(expense)}
          size="icon-sm"
          variant="ghost"
        >
          <Pencil aria-hidden="true" />
        </Button>
      </ItemActions>
    </Item>
  );

  return (
    <div className="space-y-7">
      {filterLabel ? (
        <div className="flex items-center gap-2">
          <Button onClick={onClearFilter} size="sm" variant="outline">
            {filterLabel}
            <X aria-hidden="true" data-icon="inline-end" />
            <span className="sr-only">{t('filters.clear')}</span>
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('filters.noMatches')}</p>
      ) : (
        <>
          {daySections.map((day) => (
            <EditorialSection
              actions={
                <p className="text-sm font-medium text-muted-foreground">
                  {t('dayActualSummary', { total: daySummary(day) })}
                </p>
              }
              key={day.id}
              title={dateOnly(day.date)}
            >
              <ItemGroup aria-label={t('expenseList')} variant="list">
                {day.expenses.map(renderExpense)}
              </ItemGroup>
            </EditorialSection>
          ))}
          {unassignedExpenses.length ? (
            <EditorialSection
              description={t('tripLevelExpensesDescription')}
              title={t('tripLevelExpenses')}
            >
              <ItemGroup aria-label={t('tripLevelExpenses')} variant="list">
                {unassignedExpenses.map(renderExpense)}
              </ItemGroup>
            </EditorialSection>
          ) : null}
        </>
      )}
    </div>
  );
}
