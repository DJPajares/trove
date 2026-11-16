'use client';

import { useLocale, useTranslations } from 'next-intl';

import { formatMinorUnits } from '@/lib/currency/money';
import type { DayRollup, SpendBreakdown } from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

/** The tallest column; every other day is drawn against the chart's scale. */
const COLUMN_HEIGHT = 96;

/** Pixels from the chart's bottom edge to where a column's bar starts. */
const BAR_BASELINE = 44;

/** Minor units per major unit, the scale every converted total is kept in. */
const MINOR_UNITS = 100;

/**
 * The trip's spending day by day, as one row of columns in a card - each
 * column labelled with what it cost, a dashed line where the budget's even
 * share of a day sits, and one sentence saying which day cost the most.
 * Tapping a day shows only its expenses below; tapping it again shows them all.
 *
 * Every column is a button named in words (date, amount, share of the trip),
 * so the chart reads aloud as the list of days it replaces.
 */
export function SpendDayStrip({
  activeId,
  breakdown,
  budgetPerDay,
  currencyCode,
  onSelect,
}: Readonly<{
  activeId: string | null;
  breakdown: SpendBreakdown;
  /** The budget's even share of one day, in minor units; null draws no line. */
  budgetPerDay: number | null;
  currencyCode: string;
  onSelect: (id: string) => void;
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  const compact = (minorUnits: number) => {
    const value = minorUnits / MINOR_UNITS;
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: value < 10 ? 1 : 0,
      notation: 'compact',
    }).format(value);
  };
  const date = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const spentOn = (day: DayRollup) => day.actual.minorUnits ?? 0;
  const largest = Math.max(...breakdown.days.map(spentOn), 0);
  // The budget line stays on the chart even when every day came in under it.
  const scale = Math.max(largest, budgetPerDay ?? 0);
  const heightOf = (minorUnits: number) => (scale > 0 ? (minorUnits / scale) * COLUMN_HEIGHT : 0);
  const money = (minorUnits: number) => formatMinorUnits(locale, minorUnits, currencyCode);
  const active = breakdown.days.find((day) => day.id === activeId) ?? null;
  const spendingDays = breakdown.days.filter((day) => spentOn(day) > 0);
  const biggest =
    spendingDays.length > 1
      ? spendingDays.reduce((top, day) => (spentOn(day) > spentOn(top) ? day : top))
      : null;
  const shortDate = (value: string) =>
    date(value, { day: 'numeric', month: 'short', weekday: 'short' });

  const column = (day: DayRollup) => {
    const spent = spentOn(day);
    const selected = day.id === activeId;
    const height = spent > 0 ? Math.max(4, heightOf(spent)) : 0;

    return (
      <li className="flex w-7 min-w-7 flex-1 shrink-0 flex-col items-center" key={day.id}>
        <button
          aria-current={day.isToday ? 'date' : undefined}
          aria-label={t('a11y.dayBar', {
            amount: spent ? money(spent) : t('day.nothing'),
            date: date(day.date, { day: 'numeric', month: 'long', weekday: 'long' }),
            percent: percent.format(day.share),
          })}
          aria-pressed={selected}
          className={cn(
            'group flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-md)] py-1.5 outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none motion-reduce:transition-none',
            selected && 'bg-secondary',
          )}
          disabled={spent === 0}
          onClick={() => onSelect(day.id)}
          type="button"
        >
          <span
            aria-hidden="true"
            className="flex w-full flex-col items-center justify-end gap-1"
            style={{ height: COLUMN_HEIGHT + 16 }}
          >
            {spent ? (
              <>
                <span
                  className={cn(
                    'text-[0.625rem] leading-none font-semibold tabular-nums',
                    selected || day.isOutlier ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {compact(spent)}
                </span>
                <span
                  className={cn(
                    'w-5 rounded-t-[0.35rem] rounded-b-[0.15rem] transition-[height] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                    day.isOutlier ? 'bg-status-warning' : selected ? 'bg-primary' : 'bg-primary/55',
                    !selected && 'group-hover:bg-primary/75',
                  )}
                  style={{ height }}
                />
              </>
            ) : (
              <span className="h-0.5 w-3 rounded-full bg-border" />
            )}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'flex flex-col items-center text-[0.6875rem] leading-tight tabular-nums',
              day.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <span>{date(day.date, { weekday: 'narrow' })}</span>
            <span>{date(day.date, { day: 'numeric' })}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-surface)]">
      {/* What the chart says, in words: the chosen day, else the biggest one. */}
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground tabular-nums">
        {active
          ? t('day.selected', {
              amount: money(spentOn(active)),
              date: shortDate(active.date),
            })
          : biggest
            ? t('day.biggest', { amount: money(spentOn(biggest)), date: shortDate(biggest.date) })
            : t('day.hint')}
      </p>
      <div className="relative">
        {budgetPerDay && scale > 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-muted-foreground/60"
            // Bars stand on BAR_BASELINE: the list's padding, the button's
            // inset, the two-line date and the gap above it.
            style={{ bottom: heightOf(budgetPerDay) + BAR_BASELINE }}
          >
            <span className="absolute -top-4 right-0 bg-card pl-1 text-[0.625rem] leading-none text-muted-foreground tabular-nums">
              {t('day.budgetLine', { amount: compact(budgetPerDay) })}
            </span>
          </div>
        ) : null}
        <ScrollShadow
          orientation="horizontal"
          render={<ol />}
          aria-label={t('day.label')}
          className="interaction-scrollbar -mx-1 flex gap-0.5 px-1 pb-1"
        >
          {breakdown.days.map(column)}
        </ScrollShadow>
      </div>
      {breakdown.offDay.count > 0 && breakdown.offDay.total.minorUnits !== null ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {t('day.offDay', {
            amount: money(breakdown.offDay.total.minorUnits),
            count: breakdown.offDay.count,
          })}
        </p>
      ) : null}
    </div>
  );
}
