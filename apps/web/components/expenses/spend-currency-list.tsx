'use client';

import { useLocale, useTranslations } from 'next-intl';

import { formatCurrencyAmount, formatMinorUnits } from '@/lib/currency/money';
import type { CurrencyRollup } from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';

/**
 * What the traveller actually handed over, in the currency they handed it over
 * in - and only then what it is worth at home.
 *
 * This is the one view that does not flatten the trip into a single currency.
 * The paid amount leads because it is the fact; the converted one follows
 * because it is an estimate, and an amount that could not be priced at all says
 * so rather than showing a zero.
 */
export function SpendCurrencyList({
  activeId,
  onSelect,
  referenceCurrency,
  rows,
}: Readonly<{
  activeId: string | null;
  onSelect: (currencyCode: string) => void;
  referenceCurrency: string;
  rows: readonly CurrencyRollup[];
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();

  return (
    <ul className="space-y-0.5">
      {rows.map((row) => {
        const active = row.paid.currencyCode === activeId;
        const isReference = row.paid.currencyCode === referenceCurrency;

        return (
          <li key={row.paid.currencyCode}>
            <button
              aria-pressed={active}
              className={cn(
                'flex min-h-11 w-full items-baseline justify-between gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40',
                active && 'bg-secondary',
              )}
              onClick={() => onSelect(row.paid.currencyCode)}
              type="button"
            >
              <span className="min-w-0 truncate text-sm font-medium tabular-nums">
                {formatCurrencyAmount(locale, row.paid.amount, row.paid.currencyCode)}
              </span>
              {isReference ? null : (
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {row.worth.minorUnits === null
                    ? t('breakdowns.currency.unpriced')
                    : t('breakdowns.currency.worth', {
                        amount: formatMinorUnits(locale, row.worth.minorUnits, referenceCurrency),
                      })}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
