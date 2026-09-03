'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SpendBudgetBar } from '@/components/expenses/spend-budget-bar';
import { useTripContext } from '@/components/trip-provider';
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
  const locale = useLocale();
  const trip = useTripContext()?.trip ?? null;
  const now = useNowTick(true);

  const { board, boardStatus, reference } = useSpendReference(actualSpend, budget);

  if (!reference) {
    return (
      <EmptyPosition
        action={
          <Button onClick={onEditBudget} size="sm" variant="outline">
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

  return (
    <section
      aria-label={t('title', { trip: trip?.name ?? '' })}
      className="border-y border-border py-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{t('spend.totalLabel')}</p>
          <TotalAmount reference={reference.code} total={actual} />
        </div>
        <Button onClick={onEditBudget} size="sm" variant="ghost">
          {budget ? t('editBudget') : t('setBudget')}
        </Button>
      </div>

      {position.verdict === 'unknown' ? (
        // Only an absent budget is worth prompting for. A budget that is set but
        // cannot be priced is explained by the note below, not by asking the
        // traveller to set the thing they have already set.
        budget ? null : (
          <p className="mt-4 text-sm text-muted-foreground">{t('spend.noBudgetPrompt')}</p>
        )
      ) : (
        <div className="mt-4 space-y-2">
          <SpendBudgetBar currencyCode={reference.code} position={position} />
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
      )}

      {perDay !== null || perRemainingDay !== null ? (
        <p className="mt-3 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          {perDay !== null ? (
            <span>
              {t(pace?.phase === 'finished' ? 'spend.pace.perDayFinished' : 'spend.pace.perDay', {
                amount: formatMinorUnits(locale, perDay, reference.code),
              })}
            </span>
          ) : null}
          {perRemainingDay !== null && pace ? (
            <span>
              {t('spend.pace.remainingPerDay', {
                amount: formatMinorUnits(locale, perRemainingDay, reference.code),
                days: pace.remainingDays,
              })}
            </span>
          ) : null}
        </p>
      ) : null}

      <ApproximationNote boardStatus={boardStatus} locale={locale} now={now} total={actual} />
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
              date: total.rateDate ?? '',
            })
          : undefined
      }
      className="flex items-baseline gap-1 text-2xl font-semibold tracking-tight tabular-nums"
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
  locale,
  now,
  total,
}: Readonly<{
  boardStatus: 'loading' | 'ready' | 'unavailable';
  locale: string;
  now: Date;
  total: ConvertedTotal;
}>) {
  const t = useTranslations('expenses');
  const notes: string[] = [];
  const rateDate = total.rateDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(`${total.rateDate}T00:00:00.000Z`),
      )
    : null;

  // While the board is still on its way the total legitimately reads as the
  // amounts that were paid - but saying rates are unavailable before we know
  // that would be a claim the screen has to take back a moment later.
  if (total.minorUnits === null) {
    if (boardStatus !== 'loading') notes.push(t('spend.approximate.unavailable'));
  } else if (total.rateDate && rateDate) {
    const daysOld = Math.floor(
      (Date.parse(`${total.rateDate}T00:00:00.000Z`) - now.getTime()) / -86_400_000,
    );
    notes.push(
      total.rateSource === 'cache' && daysOld > STALE_RATE_DAYS
        ? t('spend.approximate.stale', { date: rateDate })
        : t('spend.approximate.rateDate', { date: rateDate }),
    );
  }

  if (total.minorUnits !== null && total.unconvertible.length > 0) {
    notes.push(t('spend.approximate.unconvertible', { count: total.unconvertible.length }));
  }

  if (!notes.length) return null;

  return <p className="mt-3 text-xs text-muted-foreground">{notes.join(' ')}</p>;
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
