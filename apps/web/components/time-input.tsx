'use client';

import { Clock3, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  formatSegmentedTime,
  nearestTimeSegment,
  parseCanonicalTime,
  parseTimeInput,
  replaceTimePeriod,
  type TimeSegmentKind,
} from '@/lib/time/time-segments';
import { cn } from '@/lib/utils';

function useMobilePicker() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return mobile;
}

type TimePickerFieldsProps = {
  onChange: (value: string) => void;
  value: string;
};

function TimePickerFields({ onChange, value }: Readonly<TimePickerFieldsProps>) {
  const t = useTranslations('travelInputs.time');
  const { preferences } = usePreferences();
  const fieldId = useId();
  const parts = parseCanonicalTime(value) ?? { hour: 9, minute: 0 };
  const twelveHour = preferences.timeFormat === '12h';
  const period = parts.hour >= 12 ? 'pm' : 'am';
  const displayHour = twelveHour ? parts.hour % 12 || 12 : parts.hour;
  const hours = useMemo(
    () => Array.from({ length: twelveHour ? 12 : 24 }, (_, index) => index + (twelveHour ? 1 : 0)),
    [twelveHour],
  );
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);

  function commit(hour: number, minute: number, nextPeriod = period) {
    const canonicalHour = twelveHour ? (hour % 12) + (nextPeriod === 'pm' ? 12 : 0) : hour;
    onChange(`${canonicalHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
  }

  return (
    <div className={cn('grid gap-3', twelveHour ? 'grid-cols-3' : 'grid-cols-2')}>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${fieldId}-hour`}>
          {t('hour')}
        </label>
        <Select
          onValueChange={(next) => next && commit(Number(next), parts.minute)}
          value={displayHour.toString()}
        >
          <SelectTrigger className="w-full tabular-nums" id={`${fieldId}-hour`}>
            <SelectValue>{displayHour.toString().padStart(2, '0')}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {hours.map((hour) => (
              <SelectItem key={hour} value={hour.toString()}>
                {hour.toString().padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${fieldId}-minute`}>
          {t('minute')}
        </label>
        <Select
          onValueChange={(next) => next && commit(displayHour, Number(next))}
          value={parts.minute.toString()}
        >
          <SelectTrigger className="w-full tabular-nums" id={`${fieldId}-minute`}>
            <SelectValue>{parts.minute.toString().padStart(2, '0')}</SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {minutes.map((minute) => (
              <SelectItem key={minute} value={minute.toString()}>
                {minute.toString().padStart(2, '0')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {twelveHour ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`${fieldId}-period`}>
            {t('period')}
          </label>
          <Select
            onValueChange={(next) => next && commit(displayHour, parts.minute, next)}
            value={period}
          >
            <SelectTrigger className="w-full" id={`${fieldId}-period`}>
              <SelectValue>{t(period)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="am">{t('am')}</SelectItem>
              <SelectItem value="pm">{t('pm')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

type TimeInputProps = Omit<ComponentProps<typeof Input>, 'onChange' | 'type' | 'value'> & {
  onValueChange: (value: string) => void;
  value: string;
};

export function TimeInput({
  'aria-invalid': ariaInvalid,
  className,
  disabled,
  id,
  onBlur,
  onClick,
  onFocus,
  onKeyDown,
  onValueChange,
  required,
  value,
  ...props
}: Readonly<TimeInputProps>) {
  const t = useTranslations('travelInputs.time');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const mobile = useMobilePicker();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [activeSegment, setActiveSegment] = useState<TimeSegmentKind | null>(null);
  const [displayValue, setDisplayValue] = useState(
    () => formatSegmentedTime(value, locale, preferences.timeFormat).text,
  );

  useEffect(() => {
    if (!focused) {
      setDisplayValue(formatSegmentedTime(value, locale, preferences.timeFormat).text);
    }
  }, [focused, locale, preferences.timeFormat, value]);

  function selectTime(nextValue: string) {
    onValueChange(nextValue);
    setDisplayValue(formatSegmentedTime(nextValue, locale, preferences.timeFormat).text);
    setInvalid(false);
  }

  function getCurrentDisplay() {
    const canonical = parseTimeInput(displayValue, locale) ?? value;
    return { canonical, ...formatSegmentedTime(canonical, locale, preferences.timeFormat) };
  }

  function selectSegment(
    input: HTMLInputElement,
    kind: TimeSegmentKind,
    canonical = getCurrentDisplay().canonical,
  ) {
    const segment = formatSegmentedTime(canonical, locale, preferences.timeFormat).segments.find(
      (candidate) => candidate.kind === kind,
    );
    if (!segment) return;
    setActiveSegment(kind);
    window.requestAnimationFrame(() => input.setSelectionRange(segment.start, segment.end));
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen && !value) selectTime('09:00');
    setOpen(nextOpen);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      setOpen(true);
    }

    const current = getCurrentDisplay();
    const selected =
      current.segments.find((segment) => segment.kind === activeSegment) ??
      nearestTimeSegment(current.segments, event.currentTarget.selectionStart ?? 0);
    const selectedIndex = selected ? current.segments.indexOf(selected) : -1;

    if (selectedIndex >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const next = current.segments[selectedIndex + direction];
      if (next) {
        event.preventDefault();
        selectSegment(event.currentTarget, next.kind, current.canonical);
      }
    }

    if (selectedIndex >= 0 && event.key === 'Tab') {
      const direction = event.shiftKey ? -1 : 1;
      const next = current.segments[selectedIndex + direction];
      if (next) {
        event.preventDefault();
        selectSegment(event.currentTarget, next.kind, current.canonical);
      } else {
        setActiveSegment(null);
      }
    }

    if (selected?.kind === 'period' && /^[ap]$/i.test(event.key)) {
      const nextValue = replaceTimePeriod(
        current.canonical,
        event.key.toLocaleLowerCase() === 'a' ? 'am' : 'pm',
      );
      if (nextValue) {
        event.preventDefault();
        selectTime(nextValue);
        selectSegment(event.currentTarget, 'period', nextValue);
      }
    } else if (selected?.kind === 'period' && /^\d$/.test(event.key)) {
      event.preventDefault();
    }

    onKeyDown?.(event);
  }

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    const current = getCurrentDisplay();
    const segment = nearestTimeSegment(current.segments, event.currentTarget.selectionStart ?? 0);
    if (segment) selectSegment(event.currentTarget, segment.kind, current.canonical);
    onClick?.(event);
  }

  const trigger = (
    <Button
      aria-label={t('open')}
      className="absolute inset-y-1 right-1"
      disabled={disabled}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Clock3 aria-hidden="true" />
    </Button>
  );

  return (
    <div className="relative max-w-56">
      <Input
        {...props}
        aria-invalid={ariaInvalid || invalid || undefined}
        className={cn('pr-18 tabular-nums', className)}
        disabled={disabled}
        id={id}
        onBlur={(event) => {
          setFocused(false);
          setActiveSegment(null);
          const currentFormatted = formatSegmentedTime(value, locale, preferences.timeFormat).text;
          const parsed =
            event.currentTarget.value === currentFormatted
              ? value
              : parseTimeInput(event.currentTarget.value, locale);
          if (parsed) selectTime(parsed);
          else if (!event.currentTarget.value.trim()) {
            onValueChange('');
            setInvalid(false);
          } else {
            onValueChange('');
            setInvalid(true);
          }
          onBlur?.(event);
        }}
        onChange={(event) => {
          const nextDisplay = event.target.value;
          const parsed = parseTimeInput(nextDisplay, locale);
          setDisplayValue(nextDisplay);
          setInvalid(Boolean(nextDisplay) && !parsed);
          onValueChange(parsed ?? '');
        }}
        onClick={handleClick}
        onFocus={(event) => {
          setFocused(true);
          selectSegment(event.currentTarget, 'hour');
          onFocus?.(event);
        }}
        onKeyDown={handleKeyDown}
        placeholder={preferences.timeFormat === '12h' ? t('placeholder12') : t('placeholder24')}
        required={required}
        type="text"
        value={displayValue}
      />
      {value ? (
        <Button
          aria-label={t('clear')}
          className="absolute inset-y-1 right-10"
          disabled={disabled}
          onClick={() => selectTime('')}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
      {mobile ? (
        <>
          <Button
            aria-label={t('open')}
            className="absolute inset-y-1 right-1"
            disabled={disabled}
            onClick={() => changeOpen(true)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Clock3 aria-hidden="true" />
          </Button>
          <Sheet onOpenChange={changeOpen} open={open}>
            <SheetContent closeLabel={t('close')} side="bottom">
              <SheetHeader className="border-b">
                <SheetTitle>{t('title')}</SheetTitle>
              </SheetHeader>
              <div className="p-5">
                <TimePickerFields onChange={selectTime} value={value} />
              </div>
              <SheetFooter>
                <Button onClick={() => changeOpen(false)} type="button">
                  {t('done')}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover onOpenChange={changeOpen} open={open}>
          <PopoverTrigger render={trigger} />
          <PopoverContent align="end" className="w-80" sideOffset={8}>
            <p className="font-medium">{t('title')}</p>
            <TimePickerFields onChange={selectTime} value={value} />
            <div className="flex justify-end border-t pt-3">
              <Button onClick={() => changeOpen(false)} size="sm" type="button">
                {t('done')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
