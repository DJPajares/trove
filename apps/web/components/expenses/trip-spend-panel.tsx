'use client';
import { useTripReadOnly } from '@/components/trip-provider';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SpendBudgetBar } from '@/components/expenses/spend-budget-bar';
import { useTripContext } from '@/components/trip-provider';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSpendReference } from '@/hooks/use-spend-reference';
import { formatCurrencyAmount, formatMinorUnits } from '@/lib/currency/money';
import type { CurrencyTotal } from '@/lib/expenses/api';
import {
  budgetPerRemainingDay,
  convertTotals,
  resolveBudgetPosition,
  resolveTripPace,
  spendPerDay,
  type ConvertedTotal,
} from '@/lib/expenses/spend-insights';
import { useNowTick } from '@/hooks/use-now-tick';
import { cn } from '@/lib/utils';

/**
 * How old a cached board may be before the total stops being stated plainly.
 *
 * A board is published once a working day, so a weekend alone puts a perfectly
 * ordinary answer three days back. Past that, an offline device is quoting a
 * week-old market and should say so.
 */
const STALE_RATE_DAYS = 3;

const VERDICT_TONE = {
  ahead: 'text-status-warning',
  onTrack: 'text-status-success',
  over: 'text-status-danger',
} as const;

export function TripSpendPanel({
  actualSpend,
  budget,
  onEditBudget,
}: Readonly<{
  actualSpend: CurrencyTotal[];
  budget: CurrencyTotal | null;
  onEditBudget: () => void;
}>) {
  const t = useTranslations('expenses');
  const readOnly = useTripReadOnly();
  const locale = useLocale();
  const trip = useTripContext()?.trip ?? null;
  const now = useNowTick(true);

  const { board, boardStatus, reference } = useSpendReference(actualSpend, budget);

  if (!reference) {
    return (
      <EmptyPosition
        action={
          <Button disabled={readOnly} onClick={onEditBudget} size="sm" variant="outline">
            {t('setBudget')}
          </Button>
        }
        label={t('spend.totalLabel')}
        value={t('noActualSpend')}
      />
    );
  }

  const actual = convertTotals(actualSpend, reference.code, board);
  const budgetTotal = budget ? convertTotals([budget], reference.code, board) : null;
  const pace = trip
    ? resolveTripPace({
        endDate: trip.endDate,
        now,
        referenceTimeZone: trip.referenceTimeZone,
        startDate: trip.startDate,
      })
    : null;
  const position = resolveBudgetPosition({
    actual,
    budget: budgetTotal,
    pace: pace ?? { elapsedDays: 0, phase: 'upcoming', remainingDays: 0, totalDays: 0 },
  });

  const perDay = pace ? spendPerDay(actual.minorUnits, pace.elapsedDays) : null;
  const perRemainingDay = pace
    ? budgetPerRemainingDay(position.remainingMinorUnits, pace.remainingDays)
    : null;
  const percentLabel = new Intl.NumberFormat(locale, { style: 'percent' });

  const stats = [
    perDay !== null
      ? {
          label: t('spend.stats.dailyAverage'),
          value: formatMinorUnits(locale, perDay, reference.code),
        }
      : null,
    perRemainingDay !== null && pace
      ? {
          label: t('spend.stats.leftPerDay', { days: pace.remainingDays }),
          value: formatMinorUnits(locale, perRemainingDay, reference.code),
        }
      : null,
  ].filter((stat): stat is { label: string; value: string } => stat !== null);

  return (
    <section
      aria-label={t('title', { trip: trip?.name ?? '' })}
      className="space-y-4 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">{t('spend.totalLabel')}</p>
          <TotalAmount reference={reference.code} total={actual} />
        </div>
        {budget ? (
          <Button
            className="-mr-2 shrink-0"
            disabled={readOnly}
            onClick={onEditBudget}
            size="sm"
            variant="ghost"
          >
            {t('editBudget')}
          </Button>
        ) : null}
      </div>

      {position.verdict !== 'unknown' ? (
        <div className="space-y-2">
          <SpendBudgetBar
            currencyCode={reference.code}
            paceRatio={pace && pace.totalDays > 0 ? pace.elapsedDays / pace.totalDays : null}
            position={position}
          />
          <p className={cn('text-sm font-medium', VERDICT_TONE[position.verdict])}>
            {t(`spend.verdict.${pace?.phase ?? 'upcoming'}.${position.verdict}`, {
              amount: formatMinorUnits(
                locale,
                position.verdict === 'over'
                  ? position.overByMinorUnits
                  : Math.max(0, position.remainingMinorUnits ?? 0),
                reference.code,
              ),
              spentPercent: percentLabel.format(position.spentRatio),
              tripPercent: percentLabel.format(
                pace && pace.totalDays > 0 ? pace.elapsedDays / pace.totalDays : 0,
              ),
            })}
          </p>
        </div>
      ) : null}

      {stats.length ? (
        <dl className="grid grid-cols-2 gap-2">
          {stats.map((stat) => (
            <div
              className="flex flex-col-reverse gap-0.5 rounded-[var(--radius-lg)] bg-surface-tint/60 px-3 py-2.5"
              key={stat.label}
            >
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-base font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Without a budget there is nothing to be on track for; offer one, quietly. */}
      {budget ? null : (
        <Button
          className="w-full border-dashed"
          disabled={readOnly}
          onClick={onEditBudget}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('spend.addBudget')}
        </Button>
      )}

      <ApproximationNote boardStatus={boardStatus} now={now} total={actual} />
    </section>
  );
}

function TotalAmount({ reference, total }: Readonly<{ reference: string; total: ConvertedTotal }>) {
  const t = useTranslations('expenses');
  const locale = useLocale();

  // Nothing could be priced, so the honest answer is what was actually paid.
  if (total.minorUnits === null) {
    return (
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {total.unconvertible
          .map((paid) => formatCurrencyAmount(locale, paid.amount, paid.currencyCode))
          .join(' · ')}
      </p>
    );
  }

  const amount = formatMinorUnits(locale, total.minorUnits, reference);

  return (
    <p
      aria-label={
        total.isApproximate
          ? t('a11y.spendTotal', {
              amount,
              count: total.contributing.length,
            })
          : undefined
      }
      className="flex items-baseline gap-1 text-3xl font-semibold tracking-[-0.02em] tabular-nums"
    >
      {total.isApproximate ? (
        <span aria-hidden="true" className="text-muted-foreground">
          ≈
        </span>
      ) : null}
      {amount}
    </p>
  );
}

/**
 * Says how the total was arrived at, and where it stops being knowable.
 *
 * Every branch here is a sentence rather than a glyph, because "approximately"
 * is a claim about the number that a symbol beside it cannot actually make.
 */
function ApproximationNote({
  boardStatus,
  now,
  total,
}: Readonly<{
  boardStatus: 'loading' | 'ready' | 'unavailable';
  now: Date;
  total: ConvertedTotal;
}>) {
  const t = useTranslations('expenses');
  const notes: string[] = [];
  // While the board is still on its way the total legitimately reads as the
  // amounts that were paid - but saying rates are unavailable before we know
  // that would be a claim the screen has to take back a moment later.
  if (total.minorUnits === null) {
    if (boardStatus !== 'loading') notes.push(t('spend.approximate.unavailable'));
  } else if (total.rateDate) {
    const daysOld = Math.floor(
      (Date.parse(`${total.rateDate}T00:00:00.000Z`) - now.getTime()) / -86_400_000,
    );
    notes.push(
      total.rateSource === 'cache' && daysOld > STALE_RATE_DAYS
        ? t('spend.approximate.stale')
        : t('spend.approximate.reference'),
    );
  }

  if (total.minorUnits !== null && total.unconvertible.length > 0) {
    notes.push(t('spend.approximate.unconvertible', { count: total.unconvertible.length }));
  }

  if (!notes.length) return null;

  return <p className="text-xs text-muted-foreground">{notes.join(' ')}</p>;
}

function EmptyPosition({
  action,
  label,
  value,
}: Readonly<{ action: ReactNode; label: string; value: string }>) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-y border-border py-5">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-lg font-semibold tracking-tight text-muted-foreground">{value}</p>
      </div>
      {action}
    </section>
  );
}
