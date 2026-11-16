'use client';

import { CalendarPlus, ChevronRight, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useTripReadOnly } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
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
import { resolveExpenseCategory, type SpendCategoryKey } from '@/lib/expenses/categories';
import * as Icons from '@/lib/icons';
import {
  approximateInReference,
  expenseDayId,
  matchesSpendFilter,
  type SpendFilter,
} from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';

/**
 * Every recorded expense, grouped by the day it belongs to, newest day first,
 * under a row of category chips that narrow it.
 *
 * Amounts here are always the currency the traveller actually paid in. The
 * converted view lives at the top of the screen; a ledger that rewrote what a
 * receipt said would be a worse record than the receipt.
 */
export function ExpenseLedger({
  categories,
  days,
  expenses,
  filter,
  filterLabel,
  onClearFilter,
  onEdit,
  onFilterChange,
  board,
  reference,
}: Readonly<{
  /** The categories this trip has spent in, biggest first: the chips offered. */
  categories: readonly SpendCategoryKey[];
  days: ReadonlyArray<{ actualSpend: CurrencyTotal[]; date: string; id: string }>;
  expenses: readonly Expense[];
  filter: SpendFilter | null;
  /** Names the active filter in the traveller's own words, or null when there is none. */
  filterLabel: string | null;
  onClearFilter: () => void;
  onEdit: (expense: Expense) => void;
  onFilterChange: (filter: SpendFilter | null) => void;
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

  // Newest day first: during a trip, what was just spent is what gets checked.
  const daySections = days
    .map((day) => ({ ...day, expenses: expensesByDay.get(day.id) ?? [] }))
    .filter((day) => day.expenses.length > 0)
    .reverse();

  const money = (total: CurrencyTotal) =>
    formatCurrencyAmount(locale, total.amount, total.currencyCode);
  const dayHeading = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    }).format(new Date(`${value}T00:00:00.000Z`));
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
    const { Icon, tintClassName } = resolveExpenseCategory(expense.category);
    const meta = [
      expense.tripPlace ? placeLabel(expense.tripPlace) : null,
      expense.category ? t(`categories.${expense.category}`) : null,
    ].filter(Boolean);
    const onDay = Boolean(expenseDayId(expense, days));
    const rowApproximate = approximate([
      { amount: expense.amount, currencyCode: expense.currencyCode },
    ]);
    return (
      <Item
        className="relative flex-nowrap items-start px-4 py-3 hover:bg-surface-hover"
        key={expense.id}
      >
        <ItemMedia
          className={cn('size-10 rounded-[var(--radius-md)]', tintClassName)}
          variant="icon"
        >
          <Icon aria-hidden="true" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
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
          {/* Where and what kind, on one quiet line. */}
          {meta.length ? (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              {expense.tripPlace ? (
                <Icons.Place aria-hidden="true" className="size-3.5 shrink-0" />
              ) : null}
              <span className="truncate">{meta.join(' · ')}</span>
            </p>
          ) : null}
          {expense.note ? (
            <p className="line-clamp-2 text-sm leading-5 text-pretty text-text-subtle">
              <span className="sr-only">{t('note')}: </span>
              {expense.note}
            </p>
          ) : null}
          {expense.localDate && !onDay ? (
            <span className="text-xs text-muted-foreground tabular-nums">{expense.localDate}</span>
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

  const categoryFilter = filter?.kind === 'category' ? filter.value : null;
  const chip = (active: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'border-border bg-card hover:bg-surface-hover',
    );

  const daySection = (key: string, title: string, summary: ReactNode, rows: Expense[]) => (
    <section aria-label={title} className="space-y-2" key={key}>
      {/* The day's name and what it cost, on the page itself rather than on a
          band of its own, so the card below reads as that day's receipt. */}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {summary}
      </div>
      <ItemGroup
        aria-label={t('expenseList')}
        className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]"
        variant="list"
      >
        {rows.map(renderExpense)}
      </ItemGroup>
    </section>
  );

  return (
    <section aria-labelledby="expense-ledger-heading" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-lg font-semibold" id="expense-ledger-heading">
          {t('expenseList')}
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {t('itemCount', { count: visible.length })}
        </p>
      </div>

      {categories.length > 1 ? (
        <ScrollShadow
          aria-label={t('filters.byCategory')}
          className="-mx-1 flex gap-2 px-1 pb-1 [scrollbar-width:none]"
          orientation="horizontal"
          role="group"
        >
          <button
            aria-pressed={!filter}
            className={chip(!filter)}
            onClick={() => onFilterChange(null)}
            type="button"
          >
            {t('filters.all')}
          </button>
          {categories.map((key) => (
            <button
              aria-pressed={categoryFilter === key}
              className={chip(categoryFilter === key)}
              key={key}
              onClick={() =>
                onFilterChange(categoryFilter === key ? null : { kind: 'category', value: key })
              }
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  resolveExpenseCategory(key === 'uncategorised' ? null : key).barClassName,
                )}
              />
              {key === 'uncategorised' ? t('noCategory') : t(`categories.${key}`)}
            </button>
          ))}
        </ScrollShadow>
      ) : null}

      {/* A day, place or currency chosen above the ledger, named so it can be cleared. */}
      {filterLabel && filter?.kind !== 'category' ? (
        <div className="flex items-center gap-2">
          <Button onClick={onClearFilter} size="sm" variant="outline">
            {filterLabel}
            <X aria-hidden="true" data-icon="inline-end" />
            <span className="sr-only">{t('filters.clear')}</span>
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('filters.noMatches')}</p>
      ) : (
        <div className="space-y-6">
          {daySections.map((day) =>
            daySection(
              day.id,
              dayHeading(day.date),
              <DaySummary
                approximate={approximate(dayAmounts(day))}
                label={totals(dayAmounts(day), t('noActualSpend'))}
                srApproximate={(amount) => t('approximateAmount', { amount })}
              />,
              day.expenses,
            ),
          )}
          {unassignedExpenses.length
            ? daySection(
                'trip-level',
                t('tripLevelExpenses'),
                <p className="text-xs text-muted-foreground">
                  {t('tripLevelExpensesDescription')}
                </p>,
                unassignedExpenses,
              )
            : null}
        </div>
      )}
    </section>
  );
}

/**
 * What a day cost: the converted total when there is one, which is what the
 * rest of the screen reads in, with the paid amounts kept for anyone who asks.
 */
function DaySummary({
  approximate,
  label,
  srApproximate,
}: Readonly<{
  approximate: string | null;
  label: string;
  srApproximate: (amount: string) => string;
}>) {
  if (!approximate) {
    return <p className="text-sm font-semibold tabular-nums">{label}</p>;
  }
  return (
    <p className="text-sm tabular-nums" title={label}>
      <span aria-hidden="true" className="font-semibold">
        ≈ {approximate}
      </span>
      <span className="sr-only">
        {label}, {srApproximate(approximate)}
      </span>
    </p>
  );
}
