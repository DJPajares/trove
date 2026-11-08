'use client';

import { CalendarPlus, ChevronRight, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useTripReadOnly } from '@/components/trip-provider';
import { EditorialSection } from '@/components/editorial-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import type { CachedCurrencyRateBoard } from '@/lib/currency/api';
import {
  formatCurrencyAmount,
  formatCurrencyAmountParts,
  formatMinorUnits,
  sumByCurrency,
} from '@/lib/currency/money';
import type { CurrencyTotal, Expense, ExpensePlace } from '@/lib/expenses/api';
import {
  expenseTitle as resolveExpenseTitle,
  placeLabel as resolvePlaceLabel,
} from '@/lib/expenses/labels';
import { resolveExpenseCategory } from '@/lib/expenses/categories';
import * as Icons from '@/lib/icons';
import {
  approximateInReference,
  expenseDayId,
  matchesSpendFilter,
  type SpendFilter,
} from '@/lib/expenses/spend-insights';

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
  board,
  reference,
}: Readonly<{
  days: ReadonlyArray<{ actualSpend: CurrencyTotal[]; date: string; id: string }>;
  expenses: readonly Expense[];
  filter: SpendFilter | null;
  /** Names the active filter in the traveller's own words, or null when there is none. */
  filterLabel: string | null;
  onClearFilter: () => void;
  onEdit: (expense: Expense) => void;
  /** The rates the screen's headline already converts with; null when none were needed. */
  board: CachedCurrencyRateBoard | null;
  /** The one currency the screen's totals are in, usually the traveller's home currency. */
  reference: string | null;
}>) {
  const t = useTranslations('expenses');
  const readOnly = useTripReadOnly();
  const locale = useLocale();

  const visible = expenses.filter((expense) => matchesSpendFilter(expense, filter, days));
  const expensesByDay = new Map<string, Expense[]>();
  const unassignedExpenses: Expense[] = [];
  for (const expense of visible) {
    // The same rule the totals use, so a day's rows always add up to its total.
    const dayId = expenseDayId(expense, days);
    if (dayId) {
      const values = expensesByDay.get(dayId) ?? [];
      values.push(expense);
      expensesByDay.set(dayId, values);
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
   * arithmetic the traveller could not follow. Summed per currency, so two dong
   * dinners read as one dong total rather than a list of both.
   */
  const dayAmounts = (day: (typeof daySections)[number]): CurrencyTotal[] =>
    filter
      ? sumByCurrency(
          day.expenses.map((expense) => ({
            amount: expense.amount,
            currencyCode: expense.currencyCode,
          })),
        )
      : day.actualSpend;

  /** Roughly what something cost in the screen's own currency, beside what was paid. */
  const approximate = (amounts: readonly CurrencyTotal[]) => {
    const minorUnits = reference ? approximateInReference(amounts, reference, board) : null;
    return minorUnits === null || !reference
      ? null
      : formatMinorUnits(locale, minorUnits, reference);
  };

  const renderExpense = (expense: Expense) => {
    const { Icon } = resolveExpenseCategory(expense.category);
    const onDay = Boolean(expenseDayId(expense, days));
    const rowApproximate = approximate([
      { amount: expense.amount, currencyCode: expense.currencyCode },
    ]);
    return (
      <Item
        className="relative flex-nowrap items-start px-3 py-3.5 hover:bg-surface-hover"
        key={expense.id}
      >
        <ItemMedia
          className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
          variant="icon"
        >
          <Icon aria-hidden="true" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1.5">
          {/* What it was and what it cost read first, side by side: the amount
              keeps its own column so a long title never pushes it to a new line. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
            <ItemTitle className="line-clamp-2 text-base leading-snug font-semibold">
              {/* One real button for the row, stretched over it, so the whole
                  row opens the expense and "Add date" stays its own control. */}
              <button
                aria-label={t(readOnly ? 'viewRecord' : 'editExpense', {
                  title: expenseTitle(expense),
                })}
                className="text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/40 focus-visible:after:ring-inset"
                onClick={() => onEdit(expense)}
                type="button"
              >
                {expenseTitle(expense)}
              </button>
            </ItemTitle>
            {/* The figure carries the weight; the code is quieter, so the
                amount column stays narrow and the number reads first. What was
                paid stays the record; the home-currency figure is a quiet aside. */}
            <span className="flex flex-col items-end">
              <span className="text-base leading-snug font-semibold whitespace-nowrap tabular-nums">
                {formatCurrencyAmountParts(locale, expense.amount, expense.currencyCode).map(
                  (part, index) =>
                    part.currency ? (
                      <span className="text-xs font-medium text-muted-foreground" key={index}>
                        {part.value}
                      </span>
                    ) : (
                      part.value
                    ),
                )}
              </span>
              {rowApproximate ? (
                <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  <span aria-hidden="true">≈ {rowApproximate}</span>
                  <span className="sr-only">
                    {t('approximateAmount', { amount: rowApproximate })}
                  </span>
                </span>
              ) : null}
            </span>
          </div>
          {expense.tripPlace ? (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <Icons.Place aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="sr-only">{t('placeLabel')}: </span>
              <span className="truncate">{placeLabel(expense.tripPlace)}</span>
            </p>
          ) : null}
          {expense.note ? (
            <p className="line-clamp-2 text-sm leading-5 text-pretty text-text-subtle">
              <span className="sr-only">{t('note')}: </span>
              {expense.note}
            </p>
          ) : null}
          {expense.category || (expense.localDate && !onDay) ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
              {expense.category ? (
                <Badge size="sm" variant="muted">
                  {t(`categories.${expense.category}`)}
                </Badge>
              ) : null}
              {expense.localDate && !onDay ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {expense.localDate}
                </span>
              ) : null}
            </div>
          ) : null}
          {expense.localDate && !onDay ? (
            <p className="text-xs leading-5 text-muted-foreground">{t('unassignedDatedExpense')}</p>
          ) : null}
          {/* An expense with no date counts toward the trip, but no day can show it. */}
          {!expense.localDate ? (
            <Button
              className="relative z-10 -ml-2.5 self-start"
              onClick={() => onEdit(expense)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <CalendarPlus aria-hidden="true" data-icon="inline-start" />
              {t('addDate')}
            </Button>
          ) : null}
        </ItemContent>
        <ChevronRight
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 self-start text-text-subtle"
        />
      </Item>
    );
  };

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
                <DaySummary
                  approximate={approximate(dayAmounts(day))}
                  label={t('dayActualSummary', {
                    total: totals(dayAmounts(day), t('noActualSpend')),
                  })}
                  srApproximate={(amount) => t('approximateAmount', { amount })}
                />
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

function DaySummary({
  approximate,
  label,
  srApproximate,
}: Readonly<{
  approximate: string | null;
  label: string;
  srApproximate: (amount: string) => string;
}>) {
  return (
    <p className="text-sm font-medium text-muted-foreground">
      {label}
      {approximate ? (
        <>
          <span aria-hidden="true"> · ≈ {approximate}</span>
          <span className="sr-only">, {srApproximate(approximate)}</span>
        </>
      ) : null}
    </p>
  );
}
