'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { SpendCurrencyList } from '@/components/expenses/spend-currency-list';
import { SpendDayBars } from '@/components/expenses/spend-day-bars';
import { SpendRankList, type SpendRankRow } from '@/components/expenses/spend-rank-list';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { formatMinorUnits } from '@/lib/currency/money';
import type { ExpensePlace } from '@/lib/expenses/api';
import { resolveExpenseCategory } from '@/lib/expenses/categories';
import { placeLabel as resolvePlaceLabel } from '@/lib/expenses/labels';
import type { SpendBreakdown, SpendFilter } from '@/lib/expenses/spend-insights';

type BreakdownTab = 'day' | 'category' | 'currency' | 'place';

/** Enough to show where the money concentrated without becoming a directory. */
const PLACE_LIMIT = 8;

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
  const [tab, setTab] = useState<BreakdownTab>('day');
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  const money = (minorUnits: number | null) =>
    minorUnits === null ? '—' : formatMinorUnits(locale, minorUnits, currencyCode);

  /**
   * A filter is expressed by the row that is selected, so carrying it into a tab
   * where that row is not on screen would leave the ledger filtered by something
   * invisible.
   */
  const changeTab = (next: BreakdownTab) => {
    setTab(next);
    onFilterChange(null);
  };

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
  const placeRows: SpendRankRow[] = breakdown.byPlace.slice(0, PLACE_LIMIT).map((bucket) => ({
    amount: money(bucket.total.minorUnits),
    barClassName: 'bg-muted-foreground/50',
    count: bucket.count,
    id: bucket.key,
    label: resolvePlaceLabel(placeById.get(bucket.key) ?? null, t('unnamedPlace')),
    share: bucket.share,
  }));
  const hiddenPlaces = Math.max(0, breakdown.byPlace.length - PLACE_LIMIT);

  return (
    <Tabs
      className="space-y-4"
      onValueChange={(value) => changeTab(value as BreakdownTab)}
      value={tab}
    >
      <TabsList aria-label={t('breakdowns.label')} className="w-fit" variant="segmented">
        {(['day', 'category', 'currency', 'place'] as const).map((value) => (
          <TabsTab key={value} value={value} variant="segmented">
            {t(`breakdowns.tabs.${value}`)}
          </TabsTab>
        ))}
        <TabsIndicator variant="segmented" />
      </TabsList>

      <TabsPanel value="day">
        <SpendDayBars
          activeId={activeValue('day')}
          breakdown={breakdown}
          currencyCode={currencyCode}
          onSelect={(id) => toggle('day', id)}
        />
      </TabsPanel>

      <TabsPanel value="category">
        <SpendRankList
          activeId={activeValue('category')}
          emptyLabel={t('breakdowns.empty')}
          onSelect={(id) => toggle('category', id)}
          rowLabel={(row) =>
            t('a11y.categoryBar', {
              amount: row.amount,
              category: row.label,
              count: row.count,
              percent: percent.format(row.share),
            })
          }
          rows={categoryRows}
        />
      </TabsPanel>

      <TabsPanel value="currency">
        <SpendCurrencyList
          activeId={activeValue('currency')}
          onSelect={(code) => toggle('currency', code)}
          referenceCurrency={currencyCode}
          rows={breakdown.byCurrency}
        />
      </TabsPanel>

      <TabsPanel className="space-y-2" value="place">
        <SpendRankList
          activeId={activeValue('place')}
          emptyLabel={t('breakdowns.place.none')}
          onSelect={(id) => toggle('place', id)}
          rowLabel={(row) =>
            t('a11y.categoryBar', {
              amount: row.amount,
              category: row.label,
              count: row.count,
              percent: percent.format(row.share),
            })
          }
          rows={placeRows}
        />
        {hiddenPlaces > 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {t('breakdowns.place.more', { count: hiddenPlaces })}
          </p>
        ) : null}
      </TabsPanel>
    </Tabs>
  );
}
