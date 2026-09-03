'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Progress } from '@/components/ui/progress';
import { formatMinorUnits } from '@/lib/currency/money';
import type { BudgetPosition, BudgetVerdict } from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';

/**
 * Status tokens rather than brand ones, following the Plan Score badge: a bar
 * that reads as a call to action stops reading as a signal.
 */
const VERDICT_FILL: Record<Exclude<BudgetVerdict, 'unknown'>, string> = {
  ahead: 'bg-status-warning',
  onTrack: 'bg-status-success',
  over: 'bg-status-danger',
};

export function SpendBudgetBar({
  currencyCode,
  position,
}: Readonly<{ currencyCode: string; position: BudgetPosition }>) {
  const t = useTranslations('expenses');
  const locale = useLocale();

  if (position.verdict === 'unknown' || position.budgetMinorUnits === null) return null;

  const percent = Math.round(position.spentRatio * 100);
  const money = (minorUnits: number) => formatMinorUnits(locale, minorUnits, currencyCode);
  const percentLabel = new Intl.NumberFormat(locale, { style: 'percent' }).format(
    position.spentRatio,
  );

  return (
    <Progress.Root
      aria-valuetext={t('a11y.budgetBar', {
        budget: money(position.budgetMinorUnits),
        spent: money(position.spentMinorUnits ?? 0),
        spentPercent: percentLabel,
      })}
      className="w-full min-w-0"
      locale={locale}
      // The bar stops at full even when spending has not, because a bar that
      // overflows its own track states the overspend less clearly than the
      // sentence underneath it does.
      value={Math.min(100, percent)}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <Progress.Label className="font-medium">
          {t('spend.ofBudget', { budget: money(position.budgetMinorUnits) })}
        </Progress.Label>
        <Progress.Value className="shrink-0 tabular-nums">{() => percentLabel}</Progress.Value>
      </div>
      <Progress.Track className="h-2 overflow-hidden rounded-full bg-muted">
        <Progress.Indicator
          className={cn(
            'rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            VERDICT_FILL[position.verdict],
          )}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
