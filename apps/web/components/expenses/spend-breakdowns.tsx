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

function Section({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Where a trip's money went, as one page rather than four tabs: each day first,
 * because "what did today cost" is the question asked most during a trip;
 * then what it went on; then, only when they say something, the currencies it
 * was paid in and the places it was spent at. Any row narrows the ledger below
 * to what it counts, and choosing it again shows everything.
 */
export function SpendBreakdowns({
  breakdown,
  currencyCode,
  filter,
  onFilterChange,
  tripPlaces,
}: Readonly<{
  breakdown: SpendBreakdown;
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

  const categoryRows: SpendRankRow[] = breakdown.byCategory.map((bucket) => {
    const category = bucket.key === 'uncategorised' ? null : bucket.key;
    const { Icon, barClassName } = resolveExpenseCategory(category);

    return {
      amount: money(bucket.total.minorUnits),
      barClassName,
      count: bucket.count,
      icon: <Icon aria-hidden="true" />,
      id: bucket.key,
      label: category ? t(`categories.${category}`) : t('noCategory'),
      share: bucket.share,
    };
  });

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
      <Section title={t('breakdowns.days')}>
        <SpendDayStrip
          activeId={activeValue('day')}
          breakdown={breakdown}
          currencyCode={currencyCode}
          onSelect={(id) => toggle('day', id)}
        />
      </Section>

      {categoryRows.length ? (
        <Section title={t('breakdowns.whereItWent')}>
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
          <SpendRankList
            activeId={activeValue('category')}
            emptyLabel={t('breakdowns.empty')}
            onSelect={(id) => toggle('category', id)}
            rowLabel={rowLabel}
            rows={categoryRows}
          />
        </Section>
      ) : null}

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
