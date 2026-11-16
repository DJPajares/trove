'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { SpendCurrencyList } from '@/components/expenses/spend-currency-list';
import { SpendDayStrip } from '@/components/expenses/spend-day-strip';
import { SpendRankList, type SpendRankRow } from '@/components/expenses/spend-rank-list';
import { Button } from '@/components/ui/button';
import { formatMinorUnits } from '@/lib/currency/money';
import type { ExpensePlace } from '@/lib/expenses/api';
import { resolveExpenseCategory } from '@/lib/expenses/categories';
import { placeLabel as resolvePlaceLabel } from '@/lib/expenses/labels';
import type { SpendBreakdown, SpendFilter } from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';

/** Enough to show where the money concentrated without becoming a directory. */
const PLACE_LIMIT = 5;

function Section({
  aside,
  children,
  title,
}: Readonly<{ aside?: ReactNode; children: ReactNode; title: string }>) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside ? <p className="text-sm text-muted-foreground">{aside}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Where a trip's money went, as one page rather than four tabs: what it went
 * on first, as a card per category, because that is the question a glance
 * should answer; then each day, so a pattern across the trip shows; then, only
 * when they say something, the currencies it was paid in and the places it
 * was spent at. Any card, day or row narrows the ledger below to what it
 * counts, and choosing it again shows everything.
 */
export function SpendBreakdowns({
  breakdown,
  budgetPerDay,
  currencyCode,
  filter,
  onFilterChange,
  tripPlaces,
}: Readonly<{
  breakdown: SpendBreakdown;
  /** The budget spread evenly over the trip's days, in minor units; null without one. */
  budgetPerDay: number | null;
  currencyCode: string;
  filter: SpendFilter | null;
  onFilterChange: (filter: SpendFilter | null) => void;
  tripPlaces: readonly ExpensePlace[];
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();
  const [allPlaces, setAllPlaces] = useState(false);
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  const money = (minorUnits: number | null) =>
    minorUnits === null ? '—' : formatMinorUnits(locale, minorUnits, currencyCode);

  const toggle = (kind: SpendFilter['kind'], value: string) =>
    onFilterChange(filter?.kind === kind && filter.value === value ? null : { kind, value });

  const activeValue = (kind: SpendFilter['kind']) => (filter?.kind === kind ? filter.value : null);

  const categoryRows: (SpendRankRow & { tintClassName: string })[] = breakdown.byCategory.map(
    (bucket) => {
      const category = bucket.key === 'uncategorised' ? null : bucket.key;
      const { Icon, barClassName, tintClassName } = resolveExpenseCategory(category);

      return {
        amount: money(bucket.total.minorUnits),
        barClassName,
        count: bucket.count,
        icon: <Icon aria-hidden="true" />,
        id: bucket.key,
        label: category ? t(`categories.${category}`) : t('noCategory'),
        share: bucket.share,
        tintClassName,
      };
    },
  );

  const placeById = new Map(tripPlaces.map((place) => [place.id, place]));
  const shownPlaces = allPlaces ? breakdown.byPlace : breakdown.byPlace.slice(0, PLACE_LIMIT);
  const placeRows: SpendRankRow[] = shownPlaces.map((bucket) => ({
    amount: money(bucket.total.minorUnits),
    barClassName: 'bg-muted-foreground/50',
    count: bucket.count,
    id: bucket.key,
    label: resolvePlaceLabel(placeById.get(bucket.key) ?? null, t('unnamedPlace')),
    share: bucket.share,
  }));
  const hiddenPlaces = Math.max(0, breakdown.byPlace.length - PLACE_LIMIT);
  const rowLabel = (row: SpendRankRow) =>
    t('a11y.categoryBar', {
      amount: row.amount,
      category: row.label,
      count: row.count,
      percent: percent.format(row.share),
    });

  return (
    <div className="space-y-8">
      {categoryRows.length ? (
        <Section aside={t('breakdowns.tapToFilter')} title={t('breakdowns.whereItWent')}>
          {/* The whole trip in one bar, each category its share of it. */}
          <span aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {categoryRows
              .filter((row) => row.share > 0)
              .map((row) => (
                <span
                  className={cn('min-w-1 rounded-full', row.barClassName)}
                  key={row.id}
                  style={{ flexGrow: row.share }}
                />
              ))}
          </span>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {categoryRows.map((row) => {
              const active = activeValue('category') === row.id;
              return (
                <li key={row.id}>
                  <button
                    aria-label={rowLabel(row)}
                    aria-pressed={active}
                    className={cn(
                      'flex h-full w-full flex-col items-start gap-2 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-3 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                      active && 'border-foreground/40 bg-secondary hover:bg-secondary',
                    )}
                    onClick={() => toggle('category', row.id)}
                    type="button"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] [&_svg]:size-4',
                          row.tintClassName,
                        )}
                      >
                        {row.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {row.label}
                      </span>
                    </span>
                    <span className="text-base font-semibold tabular-nums">{row.amount}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t('breakdowns.share', { percent: percent.format(row.share) })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Section title={t('breakdowns.days')}>
        <SpendDayStrip
          activeId={activeValue('day')}
          breakdown={breakdown}
          budgetPerDay={budgetPerDay}
          currencyCode={currencyCode}
          onSelect={(id) => toggle('day', id)}
        />
      </Section>

      {/* One currency says nothing a total has not already said. */}
      {breakdown.byCurrency.length > 1 ? (
        <Section title={t('breakdowns.paidIn')}>
          <SpendCurrencyList
            activeId={activeValue('currency')}
            onSelect={(code) => toggle('currency', code)}
            referenceCurrency={currencyCode}
            rows={breakdown.byCurrency}
          />
        </Section>
      ) : null}

      {placeRows.length ? (
        <Section title={t('breakdowns.places')}>
          <SpendRankList
            activeId={activeValue('place')}
            emptyLabel={t('breakdowns.place.none')}
            onSelect={(id) => toggle('place', id)}
            rowLabel={rowLabel}
            rows={placeRows}
          />
          {hiddenPlaces > 0 ? (
            <Button
              className="-ml-2.5"
              onClick={() => setAllPlaces((value) => !value)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {allPlaces
                ? t('breakdowns.place.fewer')
                : t('breakdowns.place.all', { count: hiddenPlaces })}
            </Button>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
