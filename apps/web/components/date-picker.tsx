'use client';

import { CalendarDays, ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { Matcher } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { activityDensityForItemCount } from '@/lib/activity-density';
import { cn } from '@/lib/utils';

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type DatePickerProps = {
  activityCounts?: Readonly<Record<string, number>>;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
};

function parseDateValue(value?: string) {
  if (!value) return undefined;

  const match = DATE_VALUE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined;
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function DatePicker({
  activityCounts,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  className,
  clearable = true,
  disabled,
  id,
  label,
  max,
  min,
  onChange,
  required,
  value,
}: DatePickerProps) {
  const locale = useLocale();
  const t = useTranslations('calendar');
  const [open, setOpen] = useState(false);
  const selectedDate = useMemo(() => parseDateValue(value), [value]);
  const minDate = useMemo(() => parseDateValue(min), [min]);
  const maxDate = useMemo(() => parseDateValue(max), [max]);
  const today = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }, []);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  );
  const disabledDays = useMemo<Matcher[] | undefined>(() => {
    const matchers: Matcher[] = [];
    if (minDate) matchers.push({ before: minDate });
    if (maxDate) matchers.push({ after: maxDate });
    return matchers.length ? matchers : undefined;
  }, [maxDate, minDate]);
  const activityModifiers = useMemo(() => {
    if (!activityCounts) return undefined;

    const light: Date[] = [];
    const medium: Date[] = [];
    const packed: Date[] = [];

    for (const [value, itemCount] of Object.entries(activityCounts)) {
      const date = parseDateValue(value);
      if (!date || (minDate && date < minDate) || (maxDate && date > maxDate)) continue;

      const density = activityDensityForItemCount(itemCount);
      if (density === 'light') light.push(date);
      if (density === 'medium') medium.push(date);
      if (density === 'packed') packed.push(date);
    }

    return {
      activityLight: light,
      activityMedium: medium,
      activityPacked: packed,
    };
  }, [activityCounts, maxDate, minDate]);
  const todayDisabled = Boolean((minDate && today < minDate) || (maxDate && today > maxDate));
  const displayDate = selectedDate ? dateFormatter.format(selectedDate) : null;

  function selectDate(date: Date | undefined) {
    if (!date) return;
    onChange(toDateValue(date));
    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={
              displayDate
                ? t('changeDate', { date: displayDate, label })
                : t('chooseDate', { label })
            }
            aria-required={required}
            className={cn(
              'h-11 w-full justify-start gap-2.5 px-3 text-base font-normal md:text-sm',
              !displayDate && 'text-muted-foreground',
              className,
            )}
            disabled={disabled}
            id={id}
            type="button"
            variant="outline"
          />
        }
      >
        <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{displayDate ?? t('placeholder')}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-aria-expanded/button:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="max-h-[calc(100dvh-1rem)] w-[min(calc(100vw-1rem),21.5rem)] gap-0 overflow-y-auto p-0"
        collisionAvoidance={{ align: 'shift', fallbackAxisSide: 'none', side: 'shift' }}
        collisionPadding={8}
        positionMethod="fixed"
        sideOffset={8}
      >
        <Calendar
          autoFocus
          defaultMonth={selectedDate ?? minDate ?? today}
          disabled={disabledDays}
          labels={{
            labelNext: () => t('nextMonth'),
            labelPrevious: () => t('previousMonth'),
          }}
          mode="single"
          modifiers={activityModifiers}
          modifiersClassNames={
            activityModifiers
              ? {
                  activityLight: 'bg-primary/10 dark:bg-primary/15',
                  activityMedium: 'bg-primary/20 dark:bg-primary/25',
                  activityPacked: 'bg-primary/30 dark:bg-primary/35',
                }
              : undefined
          }
          onSelect={selectDate}
          selected={selectedDate}
        />
        <div
          className={cn(
            'flex items-center border-t border-border px-2 py-2',
            clearable ? 'justify-between' : 'justify-end',
          )}
        >
          {clearable ? (
            <Button
              disabled={!value}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t('clear')}
            </Button>
          ) : null}
          <Button
            disabled={todayDisabled}
            onClick={() => selectDate(today)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t('today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { DatePicker, parseDateValue, toDateValue };
