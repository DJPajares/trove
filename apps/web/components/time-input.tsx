'use client';

import { Clock3, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
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
  applyTimeDigit,
  canonicalFromDraft,
  draftFromCanonical,
  formatSegmentedDraft,
  formatSegmentedTime,
  nearestTimeSegment,
  parseCanonicalTime,
  parseTimeInput,
  stepTimeSegment,
  type TimeDraft,
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
  const [invalid, setInvalid] = useState(false);
  const [activeSegment, setActiveSegment] = useState<TimeSegmentKind | null>(null);
  /**
   * The time being typed. Non-null exactly while the field is focused, and it
   * is what makes an empty field segmented: a draft always renders segments,
   * where a bare value only does so once it is already complete.
   */
  const [draft, setDraft] = useState<TimeDraft | null>(null);
  const [displayValue, setDisplayValue] = useState(
    () => formatSegmentedTime(value, locale, preferences.timeFormat).text,
  );
  /**
   * Digits typed into the current segment but not yet resolved - the `1` of a
   * `12` that could still turn out to be a lone `1`.
   */
  const pendingDigits = useRef<{ digits: string; kind: TimeSegmentKind } | null>(null);

  useEffect(() => {
    if (!draft) {
      setDisplayValue(formatSegmentedTime(value, locale, preferences.timeFormat).text);
    }
  }, [draft, locale, preferences.timeFormat, value]);

  const segmentedDraft = draft ? formatSegmentedDraft(draft, locale, preferences.timeFormat) : null;

  function selectTime(nextValue: string) {
    onValueChange(nextValue);
    setDisplayValue(formatSegmentedTime(nextValue, locale, preferences.timeFormat).text);
    setInvalid(false);
  }

  function selectSegment(input: HTMLInputElement, kind: TimeSegmentKind, source: TimeDraft) {
    const segment = formatSegmentedDraft(source, locale, preferences.timeFormat).segments.find(
      (candidate) => candidate.kind === kind,
    );
    if (!segment) return;
    setActiveSegment(kind);
    window.requestAnimationFrame(() => input.setSelectionRange(segment.start, segment.end));
  }

  /**
   * A draft only reaches the form once it is a whole time. Anything less
   * reports empty, so a half-typed field is treated as unset rather than as
   * some arbitrary hour the traveller never meant to pick.
   */
  function applyDraft(next: TimeDraft) {
    setDraft(next);
    onValueChange(canonicalFromDraft(next, preferences.timeFormat) ?? '');
    setInvalid(false);
  }

  function neighbourSegment(current: TimeDraft, kind: TimeSegmentKind, direction: number) {
    const segments = formatSegmentedDraft(current, locale, preferences.timeFormat).segments;
    const index = segments.findIndex((segment) => segment.kind === kind);
    return index < 0 ? undefined : segments[index + direction];
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen && !value) selectTime('09:00');
    setOpen(nextOpen);
  }

  function typeDigit(
    input: HTMLInputElement,
    current: TimeDraft,
    kind: 'hour' | 'minute',
    key: string,
  ) {
    const buffered = pendingDigits.current?.kind === kind ? pendingDigits.current.digits : '';
    const { complete, value: settled } = applyTimeDigit(
      kind,
      buffered,
      key,
      preferences.timeFormat,
    );

    const next = { ...current, [kind]: settled };
    applyDraft(next);

    if (complete) {
      pendingDigits.current = null;
      const following = neighbourSegment(next, kind, 1);
      if (following) selectSegment(input, following.kind, next);
      else selectSegment(input, kind, next);
    } else {
      pendingDigits.current = { digits: key, kind };
      selectSegment(input, kind, next);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault();
      setOpen(true);
      onKeyDown?.(event);
      return;
    }

    const current = draft;
    if (!current) {
      onKeyDown?.(event);
      return;
    }

    const segments = formatSegmentedDraft(current, locale, preferences.timeFormat).segments;
    const selected =
      segments.find((segment) => segment.kind === activeSegment) ??
      nearestTimeSegment(segments, event.currentTarget.selectionStart ?? 0);

    if (!selected) {
      onKeyDown?.(event);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Tab') {
      const direction =
        event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
      const next = neighbourSegment(current, selected.kind, direction);
      if (next) {
        event.preventDefault();
        pendingDigits.current = null;
        selectSegment(event.currentTarget, next.kind, current);
      } else if (event.key === 'Tab') {
        setActiveSegment(null);
      }
      onKeyDown?.(event);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      pendingDigits.current = null;
      const delta = event.key === 'ArrowUp' ? 1 : -1;
      let next: TimeDraft;
      if (selected.kind === 'period') {
        next = { ...current, period: current.period === 'am' ? 'pm' : 'am' };
      } else {
        next = {
          ...current,
          [selected.kind]: stepTimeSegment(
            selected.kind,
            current[selected.kind],
            delta,
            preferences.timeFormat,
          ),
        };
      }
      applyDraft(next);
      selectSegment(event.currentTarget, selected.kind, next);
      onKeyDown?.(event);
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      pendingDigits.current = null;
      const next = { ...current, [selected.kind]: null };
      applyDraft(next);
      selectSegment(event.currentTarget, selected.kind, next);
      onKeyDown?.(event);
      return;
    }

    if (selected.kind === 'period') {
      if (/^[ap]$/i.test(event.key)) {
        event.preventDefault();
        const next = {
          ...current,
          period: event.key.toLocaleLowerCase() === 'a' ? ('am' as const) : ('pm' as const),
        };
        applyDraft(next);
        selectSegment(event.currentTarget, 'period', next);
      } else if (/^\d$/.test(event.key)) {
        event.preventDefault();
      }
      onKeyDown?.(event);
      return;
    }

    if (/^\d$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      typeDigit(event.currentTarget, current, selected.kind, event.key);
    }

    onKeyDown?.(event);
  }

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    if (draft) {
      const segments = formatSegmentedDraft(draft, locale, preferences.timeFormat).segments;
      const segment = nearestTimeSegment(segments, event.currentTarget.selectionStart ?? 0);
      if (segment) {
        pendingDigits.current = null;
        selectSegment(event.currentTarget, segment.kind, draft);
      }
    }
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
          const current = draft;
          setDraft(null);
          setActiveSegment(null);
          pendingDigits.current = null;

          if (current) {
            const canonical = canonicalFromDraft(current, preferences.timeFormat);
            if (canonical) selectTime(canonical);
            else {
              // An untouched field is simply empty; a half-typed one is wrong.
              const untouched =
                current.hour === null && current.minute === null && current.period === null;
              onValueChange('');
              setInvalid(!untouched);
            }
          }

          onBlur?.(event);
        }}
        onChange={(event) => {
          // Segment keystrokes are handled in `keydown`, so this is the paste
          // and IME path - a whole time arriving at once.
          const parsed = parseTimeInput(event.target.value, locale);
          if (parsed) {
            applyDraft(draftFromCanonical(parsed, preferences.timeFormat));
          }
        }}
        onClick={handleClick}
        onFocus={(event) => {
          const next = draftFromCanonical(value, preferences.timeFormat);
          setDraft(next);
          pendingDigits.current = null;
          selectSegment(event.currentTarget, 'hour', next);
          onFocus?.(event);
        }}
        onKeyDown={handleKeyDown}
        placeholder={preferences.timeFormat === '12h' ? t('placeholder12') : t('placeholder24')}
        required={required}
        type="text"
        value={segmentedDraft ? segmentedDraft.text : displayValue}
      />
      {value ? (
        <Button
          aria-label={t('clear')}
          className="absolute inset-y-1 right-10"
          disabled={disabled}
          onClick={() => {
            setDraft(null);
            pendingDigits.current = null;
            selectTime('');
          }}
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
