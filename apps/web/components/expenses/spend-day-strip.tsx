'use client';

import { useLocale, useTranslations } from 'next-intl';

import { formatMinorUnits } from '@/lib/currency/money';
import type { DayRollup, SpendBreakdown } from '@/lib/expenses/spend-insights';
import { cn } from '@/lib/utils';

/** The tallest column; every other day is drawn against the trip's biggest. */
const COLUMN_HEIGHT = 72;

/**
 * The trip's spending day by day, as one row of columns - a quiet day as short
 * as it was, an expensive one tinted and named, today marked. Tapping a day
 * shows only its expenses below; tapping it again shows them all.
 *
 * Every column is a button named in words (date, amount, share of the trip),
 * so the chart reads aloud as the list of days it replaces.
 */
export function SpendDayStrip({
  activeId,
  breakdown,
  currencyCode,
  onSelect,
}: Readonly<{
  activeId: string | null;
  breakdown: SpendBreakdown;
  currencyCode: string;
  onSelect: (id: string) => void;
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();
  const percent = new Intl.NumberFormat(locale, { style: 'percent' });
  const date = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const largest = Math.max(...breakdown.days.map((day) => day.actual.minorUnits ?? 0), 0);
  const money = (minorUnits: number) => formatMinorUnits(locale, minorUnits, currencyCode);
  const active = breakdown.days.find((day) => day.id === activeId) ?? null;

  const column = (day: DayRollup) => {
    const spent = day.actual.minorUnits ?? 0;
    const selected = day.id === activeId;
    const height = largest > 0 && spent > 0 ? Math.max(4, (spent / largest) * COLUMN_HEIGHT) : 0;

    return (
      <li className="flex w-9 shrink-0 flex-col items-center" key={day.id}>
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
            className="flex w-full items-end justify-center"
            style={{ height: COLUMN_HEIGHT }}
          >
            {spent ? (
              <span
                className={cn(
                  'w-4 rounded-t-[0.3rem] rounded-b-[0.15rem] transition-[height] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                  day.isOutlier ? 'bg-status-warning' : selected ? 'bg-primary' : 'bg-primary/55',
                  !selected && 'group-hover:bg-primary/75',
                )}
                style={{ height }}
              />
            ) : (
              <span className="h-0.5 w-3 rounded-full bg-border" />
            )}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'text-[0.6875rem] leading-none tabular-nums',
              day.isToday ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {date(day.date, { day: 'numeric' })}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2">
      <ol
        aria-label={t('day.label')}
        className="interaction-scrollbar -mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1"
      >
        {breakdown.days.map(column)}
      </ol>
      {/* What the selected day was, said in words beside the chart. */}
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground tabular-nums">
        {active
          ? t('day.selected', {
              amount: money(active.actual.minorUnits ?? 0),
              date: date(active.date, { day: 'numeric', month: 'short', weekday: 'short' }),
            })
          : breakdown.offDay.count > 0 && breakdown.offDay.total.minorUnits !== null
            ? t('day.offDay', {
                amount: money(breakdown.offDay.total.minorUnits),
                count: breakdown.offDay.count,
              })
            : t('day.hint')}
      </p>
    </div>
  );
}
