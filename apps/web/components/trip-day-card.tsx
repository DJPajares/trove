'use client';

import { CalendarRange } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** More than this many pips stops reading as a count and starts reading as noise. */
const MAX_PIPS = 5;

/** Days are numbered the way the day's own page does: "03", not "3". */
export function paddedDayNumber(number: number) {
  return String(number).padStart(2, '0');
}

export type TripDayCardDay = {
  attention?: boolean;
  date: string;
  id: string;
  isToday?: boolean;
  name: string | null;
  number: number;
  stopCount: number;
  town: string | null;
};

type CardProps = {
  /** The day open in the planner, or the whole trip when All days is. */
  current: boolean;
  onSelect: () => void;
  /** The ribbon keeps one tile in the tab order and moves between them with arrows. */
  tabIndex: number;
};

const cardClassName =
  'relative flex h-[5.5rem] w-[5rem] shrink-0 flex-col justify-between rounded-[var(--radius-lg)] border px-2.5 py-2.5 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none';

/** A tile of the planner ribbon, marked for its keyboard and scroll handling. */
function CardShell({
  ariaCurrent,
  children,
  className,
  label,
  onSelect,
  tabIndex,
  title,
}: Readonly<{
  ariaCurrent: 'date' | 'page' | undefined;
  children: ReactNode;
  className: string;
  label?: string;
  onSelect: () => void;
  tabIndex: number;
  title?: string;
}>) {
  return (
    <button
      aria-current={ariaCurrent}
      aria-label={label}
      className={className}
      data-ribbon-active={String(Boolean(ariaCurrent))}
      data-ribbon-tile=""
      onClick={onSelect}
      tabIndex={tabIndex}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * One day of a trip, as the planner ribbon shows it.
 *
 * Enough to choose by and nothing to decode: when it is, which day it is,
 * where it happens, and how much is on it. Weather lives on the day itself,
 * where there is room to say it honestly.
 */
export function TripDayCard({
  current,
  day,
  onSelect,
  tabIndex,
}: Readonly<CardProps & { day: TripDayCardDay }>) {
  const t = useTranslations('itinerary.planner.ribbon');
  const locale = useLocale();
  const asDate = new Date(`${day.date}T00:00:00.000Z`);
  const kicker = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(asDate);
  const longDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  }).format(asDate);
  const planned = day.stopCount > 0;
  const label = [
    day.isToday ? t('today') : null,
    t('day', { number: day.number }),
    longDate,
    day.name,
    day.town,
    t('stops', { count: day.stopCount }),
    day.attention ? t('attention') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <CardShell
      ariaCurrent={current ? 'date' : undefined}
      className={cn(
        cardClassName,
        current
          ? 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-control)]'
          : planned
            ? 'border-border-subtle bg-card text-foreground hover:bg-surface-hover'
            : 'border-dashed border-border-strong bg-transparent text-muted-foreground hover:bg-surface-hover',
      )}
      label={label}
      onSelect={onSelect}
      tabIndex={tabIndex}
      title={day.name ?? day.town ?? undefined}
    >
      <span
        aria-hidden="true"
        className={cn(
          'text-[0.625rem] leading-none font-semibold tracking-[0.08em] uppercase',
          current
            ? 'text-primary-foreground/80'
            : day.isToday
              ? 'text-brand'
              : 'text-muted-foreground',
        )}
      >
        {day.isToday ? t('today') : kicker}
      </span>
      <span
        aria-hidden="true"
        className="text-[1.5rem] leading-none font-semibold tracking-[-0.04em] tabular-nums"
      >
        {paddedDayNumber(day.number)}
      </span>
      <span aria-hidden="true" className="flex min-w-0 flex-col gap-1.5">
        <span
          className={cn(
            'block truncate text-[0.6875rem] leading-tight',
            current
              ? 'text-primary-foreground/85'
              : planned
                ? 'text-muted-foreground'
                : 'font-semibold text-accent-strong',
          )}
        >
          {day.name ?? day.town ?? (planned ? t('stops', { count: day.stopCount }) : t('open'))}
        </span>
        <span
          className={cn(
            'flex h-1 items-center gap-[3px] text-[0.625rem] leading-none',
            current ? 'text-primary-foreground/85' : 'text-muted-foreground',
          )}
        >
          {Array.from({ length: Math.min(day.stopCount, MAX_PIPS) }, (_, index) => (
            <span className="size-1 rounded-full bg-current" key={index} />
          ))}
          {day.stopCount > MAX_PIPS ? <span className="ml-px">+</span> : null}
        </span>
      </span>
      {day.attention ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-2 right-2 size-2 rounded-full bg-status-warning ring-2',
            current ? 'ring-primary' : 'ring-card',
          )}
        />
      ) : null}
    </CardShell>
  );
}

/** The whole trip, as the first card of the same strip. */
export function TripAllDaysCard({
  count,
  current,
  onSelect,
  tabIndex,
}: Readonly<CardProps & { count: number }>) {
  const t = useTranslations('itinerary.planner.ribbon');
  return (
    <CardShell
      ariaCurrent={current ? 'page' : undefined}
      className={cn(
        cardClassName,
        current
          ? 'border-primary bg-primary text-primary-foreground shadow-[var(--shadow-control)]'
          : 'border-border-subtle bg-card text-foreground hover:bg-surface-hover',
      )}
      onSelect={onSelect}
      tabIndex={tabIndex}
    >
      <CalendarRange aria-hidden="true" className="size-4" />
      <span className="text-xs leading-tight font-semibold">{t('allDays')}</span>
      <span
        className={cn(
          'text-[0.6875rem] leading-none tabular-nums',
          current ? 'text-primary-foreground/75' : 'text-muted-foreground',
        )}
      >
        {t('dayCount', { count })}
      </span>
    </CardShell>
  );
}
