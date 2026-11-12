'use client';

import { Check, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { DatePicker } from '@/components/date-picker';
import { TimeInput } from '@/components/time-input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * The journal's quiet context line - where, and when - made something to tap.
 * One line, whatever the length of the name: the full name is in the picker.
 */
export function MemoryContextChip({
  icon,
  label,
  onClick,
  placeholder,
  value,
}: Readonly<{
  icon: ReactNode;
  /** The whole sentence for a screen reader: "Where: Bếp Cuốn Đà Nẵng. Change". */
  label: string;
  onClick: () => void;
  placeholder: string;
  value: string | null;
}>) {
  return (
    <button
      aria-label={label}
      className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-[var(--radius-lg)] border border-border-subtle bg-card px-3.5 text-left text-sm outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="flex shrink-0 text-accent-strong [&_svg]:size-4">
        {icon}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          value ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {value ?? placeholder}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
    </button>
  );
}

export type WhereOption = { id: string; name: string; time: string | null };

/**
 * Where the moment happened, chosen from the day it belongs to: that day's
 * stops in the order they happened, each with its time, so the choice is made
 * against the day rather than from a list of names.
 */
export function MemoryWhereSheet({
  dayChosen,
  noneId,
  noneLabel,
  onChooseDay,
  onOpenChange,
  onSelect,
  open,
  options,
  selectedId,
}: Readonly<{
  dayChosen: boolean;
  noneId: string;
  noneLabel: string;
  onChooseDay: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  open: boolean;
  options: readonly WhereOption[];
  selectedId: string;
}>) {
  const t = useTranslations('memories.editor');
  const row = (option: WhereOption) => {
    const selected = option.id === selectedId;
    return (
      <li key={option.id}>
        <button
          aria-checked={selected}
          className={cn(
            'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
            selected && 'bg-surface-tint/70',
          )}
          onClick={() => {
            onSelect(option.id);
            onOpenChange(false);
          }}
          role="radio"
          type="button"
        >
          <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
            {option.time}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 line-clamp-2 text-sm',
              selected ? 'font-semibold text-foreground' : 'text-foreground',
            )}
          >
            {option.name}
          </span>
          {selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-brand" /> : null}
        </button>
      </li>
    );
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('cancel')}
      >
        <SheetHeading description={t('whereDescription')} title={t('whereTitle')} />
        <div className="min-h-0 flex-1 overflow-y-auto scroll-shadow-y px-3 pb-[calc(var(--safe-bottom)+1.5rem)] sm:px-5">
          {!dayChosen ? (
            <div className="mb-3 space-y-2 rounded-[var(--radius-lg)] bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">{t('chooseDayFirst')}</p>
              <Button onClick={onChooseDay} size="sm" type="button" variant="outline">
                {t('chooseDay')}
              </Button>
            </div>
          ) : null}
          <ul aria-label={t('whereTitle')} className="space-y-0.5" role="radiogroup">
            {options.map(row)}
            {row({ id: noneId, name: noneLabel, time: null })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export type WhenDay = { date: string; id: string; label: string; number: number };

/**
 * When the moment happened: a day of the trip, then a time on it. The day
 * carries the date, so there is no separate date to keep in step with it.
 */
export function MemoryWhenSheet({
  days,
  localDate,
  localTime,
  maxDate,
  minDate,
  noDayId,
  onDateChange,
  onDayChange,
  onOpenChange,
  onTimeChange,
  open,
  selectedDayId,
}: Readonly<{
  days: readonly WhenDay[];
  localDate: string;
  localTime: string;
  maxDate?: string;
  minDate?: string;
  noDayId: string;
  onDateChange: (value: string) => void;
  onDayChange: (dayId: string) => void;
  onOpenChange: (open: boolean) => void;
  onTimeChange: (value: string) => void;
  open: boolean;
  selectedDayId: string;
}>) {
  const t = useTranslations('memories.editor');
  const dayChip = (id: string, top: string, bottom: string) => {
    const selected = id === selectedDayId;
    return (
      <button
        aria-pressed={selected}
        className={cn(
          'flex min-h-14 flex-col items-start justify-center rounded-[var(--radius-lg)] border px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
          selected
            ? 'border-brand bg-brand/10 text-foreground'
            : 'border-border-subtle bg-card hover:bg-surface-hover',
        )}
        key={id}
        onClick={() => onDayChange(id)}
        type="button"
      >
        <span className="text-[0.68rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {top}
        </span>
        <span className="text-sm font-medium">{bottom}</span>
      </button>
    );
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('cancel')}
      >
        <SheetHeading description={t('whenDescription')} title={t('whenTitle')} />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto scroll-shadow-y px-4 pb-4 sm:px-6">
          <div aria-label={t('whenDay')} className="grid grid-cols-3 gap-2" role="group">
            {days.map((day) => dayChip(day.id, t('dayNumber', { number: day.number }), day.label))}
          </div>
          <div className="grid grid-cols-1">{dayChip(noDayId, t('noDayTop'), t('noDay'))}</div>
          {selectedDayId === noDayId ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="memory-when-date-input">
                {t('whenDate')}
              </label>
              <DatePicker
                id="memory-when-date-input"
                label={t('whenDate')}
                max={maxDate}
                min={minDate}
                onChange={onDateChange}
                value={localDate}
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="memory-when-time">
              {t('whenTime')}
            </label>
            <TimeInput
              disabled={!localDate}
              id="memory-when-time"
              onValueChange={onTimeChange}
              value={localTime}
            />
            <p className="text-xs text-muted-foreground">{t('capturedHint')}</p>
          </div>
        </div>
        <SheetFooter>
          <Button onClick={() => onOpenChange(false)} type="button">
            {t('done')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
