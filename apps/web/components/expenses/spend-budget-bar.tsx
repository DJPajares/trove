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
  paceRatio = null,
  position,
}: Readonly<{
  currencyCode: string;
  /** How far through the trip today is, 0-1; marks where an even spend would be. */
  paceRatio?: number | null;
  position: BudgetPosition;
}>) {
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
      <div className="relative">
        <Progress.Track className="h-2.5 overflow-hidden rounded-full bg-muted">
          <Progress.Indicator
            className={cn(
              'rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              VERDICT_FILL[position.verdict],
            )}
          />
        </Progress.Track>
        {/* Where an even spend would be by today: short of it is under pace. */}
        {paceRatio !== null && paceRatio > 0 && paceRatio < 1 ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 h-4.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
            style={{ left: `${paceRatio * 100}%` }}
          />
        ) : null}
      </div>
    </Progress.Root>
  );
}
