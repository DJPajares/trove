'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { formatMinorUnits } from '@/lib/currency/money';
import type { DayRollup, SpendBreakdown } from '@/lib/expenses/spend-insights';
import { SPEND_ROW_GRID } from '@/components/expenses/spend-rank-list';
import { cn } from '@/lib/utils';

/**
 * The shape of a trip's spending, day by day.
 *
 * Every trip day is here, including the ones nothing was spent on - a quiet day
 * is part of the shape, and dropping it would make the busy ones look ordinary.
 * The off-day row at the end is what keeps these rows adding up to the total at
 * the top of the screen.
 */
export function SpendDayBars({
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
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00.000Z`),
    );
  const largest = Math.max(...breakdown.days.map((day) => day.share), 0);
  const money = (minorUnits: number | null) =>
    minorUnits === null ? '—' : formatMinorUnits(locale, minorUnits, currencyCode);

  const row = (day: DayRollup) => {
    const active = day.id === activeId;
    const spent = day.actual.minorUnits ?? 0;

    return (
      <li key={day.id}>
        <button
          aria-current={day.isToday ? 'date' : undefined}
          aria-label={t('a11y.dayBar', {
            amount: money(day.actual.minorUnits),
            date: dayLabel(day.date),
            percent: percent.format(day.share),
          })}
          aria-pressed={active}
          className={cn(
            SPEND_ROW_GRID,
            'min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none',
            active && 'bg-secondary',
          )}
          disabled={spent === 0}
          onClick={() => onSelect(day.id)}
          type="button"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'min-w-0 truncate text-sm',
                day.isToday && 'font-semibold',
                spent === 0 && 'text-muted-foreground',
              )}
            >
              {dayLabel(day.date)}
            </span>
            {day.isToday ? (
              <Badge className="shrink-0" size="sm" variant="muted">
                {t('breakdowns.day.today')}
              </Badge>
            ) : null}
            {/* A word, never colour alone - the badge has to survive being read aloud. */}
            {day.isOutlier ? (
              <Badge className="shrink-0" size="sm" variant="warning">
                {t('breakdowns.day.outlier')}
              </Badge>
            ) : null}
          </span>
          <span
            aria-hidden="true"
            className="hidden h-1.5 self-center overflow-hidden rounded-full bg-muted sm:block"
          >
            <span
              className={cn(
                'block h-full rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                day.isOutlier ? 'bg-status-warning' : 'bg-muted-foreground/50',
              )}
              style={{ width: `${largest > 0 ? Math.round((day.share / largest) * 100) : 0}%` }}
            />
          </span>
          <span
            className={cn(
              'text-right text-sm font-medium tabular-nums',
              spent === 0 && 'text-muted-foreground',
            )}
          >
            {spent === 0 ? t('breakdowns.day.noSpend') : money(day.actual.minorUnits)}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-0.5">{breakdown.days.map(row)}</ul>
      {breakdown.offDay.count > 0 ? (
        <div
          className={cn(
            SPEND_ROW_GRID,
            'items-baseline gap-3 border-t border-border-subtle px-2 pt-3',
          )}
        >
          <p className="min-w-0 text-sm text-muted-foreground">
            {t('breakdowns.day.offDay', { count: breakdown.offDay.count })}
          </p>
          <span aria-hidden="true" className="hidden sm:block" />
          <p className="text-right text-sm font-medium tabular-nums">
            {money(breakdown.offDay.total.minorUnits)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
