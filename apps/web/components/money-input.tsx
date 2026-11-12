'use client';

import { X } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatMoneyInput,
  formatMoneyWhileTyping,
  moneyCaretAfterFormat,
  normalizeMoneyInput,
  removeDigitBesideSeparator,
} from '@/lib/currency/money';
import { cn } from '@/lib/utils';

type MoneyInputProps = Omit<
  ComponentProps<typeof Input>,
  'inputMode' | 'onChange' | 'type' | 'value'
> & {
  /**
   * Group thousands as the traveller types, rather than only once the field
   * loses focus, so a long amount can be checked before moving on.
   */
  groupWhileTyping?: boolean;
  /**
   * Accessible name for a clear button shown inside the field once it has
   * text. Leave out where the surrounding layout supplies its own.
   */
  clearLabel?: string;
  onValueChange: (value: string) => void;
  value: string;
};

export function MoneyInput({
  'aria-invalid': ariaInvalid,
  clearLabel,
  groupWhileTyping = false,
  onBlur,
  onFocus,
  onKeyDown,
  onValueChange,
  value,
  ...props
}: Readonly<MoneyInputProps>) {
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(() => formatMoneyInput(value, locale));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setDisplayValue(formatMoneyInput(value, locale));
  }, [focused, locale, value]);

  // Reformatting replaces the field's text, which sends the caret to the end;
  // put it back beside what the traveller just typed.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (caret !== null && document.activeElement === inputRef.current) {
      inputRef.current?.setSelectionRange(caret, caret);
    }
  }, [displayValue]);

  const field = (
    <Input
      enterKeyHint="done"
      {...props}
      className={clearLabel && value ? cn('pe-11', props.className) : props.className}
      aria-invalid={ariaInvalid || invalid || undefined}
      inputMode="decimal"
      onBlur={(event) => {
        setFocused(false);
        const normalized = normalizeMoneyInput(event.currentTarget.value, locale);
        if (normalized !== null) {
          onValueChange(normalized.endsWith('.') ? normalized.slice(0, -1) : normalized);
          setDisplayValue(formatMoneyInput(normalized, locale));
          setInvalid(false);
        } else {
          setDisplayValue(formatMoneyInput(value, locale));
        }
        onBlur?.(event);
      }}
      onChange={(event) => {
        let raw = event.target.value;
        let caret = event.target.selectionStart ?? raw.length;
        let normalized = normalizeMoneyInput(raw, locale);

        if (groupWhileTyping && normalized !== null) {
          const inputType = (event.nativeEvent as InputEvent).inputType;
          const direction =
            inputType === 'deleteContentBackward'
              ? 'backward'
              : inputType === 'deleteContentForward'
                ? 'forward'
                : null;
          // Deleting only a separator changes no digit; take the digit beside it.
          if (direction && normalized === normalizeMoneyInput(displayValue, locale)) {
            const removed = removeDigitBesideSeparator(raw, caret, direction);
            const next = removed ? normalizeMoneyInput(removed.raw, locale) : null;
            if (removed && next !== null) {
              raw = removed.raw;
              caret = removed.caret;
              normalized = next;
            }
          }
          const formatted = formatMoneyWhileTyping(normalized, locale);
          pendingCaret.current = moneyCaretAfterFormat(raw, caret, formatted, locale);
          setDisplayValue(formatted);
        } else {
          setDisplayValue(raw);
        }

        setInvalid(normalized === null);
        onValueChange(normalized ?? '');
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        // Return on a phone keyboard means "done": drop focus so the keyboard
        // closes and the amount settles. It must not also submit a form.
        if (event.key === 'Enter' && !event.defaultPrevented) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onFocus={(event) => {
        setFocused(true);
        setDisplayValue(
          groupWhileTyping
            ? formatMoneyWhileTyping(value, locale)
            : formatMoneyInput(value, locale, false),
        );
        onFocus?.(event);
      }}
      ref={inputRef}
      type="text"
      value={displayValue}
    />
  );

  if (!clearLabel) return field;

  return (
    <div className="relative">
      {field}
      {value ? (
        <div className="absolute inset-y-0 end-1 flex items-center">
          <Button
            aria-label={clearLabel}
            className="rounded-full text-muted-foreground"
            onClick={() => {
              // Blur first: a touch tap on a button does not always take focus
              // from the field, and a focused field keeps showing its text.
              inputRef.current?.blur();
              onValueChange('');
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
