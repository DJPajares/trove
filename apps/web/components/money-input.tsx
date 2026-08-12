'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState, type ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { formatMoneyInput, normalizeMoneyInput } from '@/lib/currency/money';

type MoneyInputProps = Omit<
  ComponentProps<typeof Input>,
  'inputMode' | 'onChange' | 'type' | 'value'
> & {
  onValueChange: (value: string) => void;
  value: string;
};

export function MoneyInput({
  'aria-invalid': ariaInvalid,
  onBlur,
  onFocus,
  onValueChange,
  value,
  ...props
}: Readonly<MoneyInputProps>) {
  const locale = useLocale();
  const [focused, setFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(() => formatMoneyInput(value, locale));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setDisplayValue(formatMoneyInput(value, locale));
  }, [focused, locale, value]);

  return (
    <Input
      {...props}
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
        const nextDisplay = event.target.value;
        const normalized = normalizeMoneyInput(nextDisplay, locale);
        setDisplayValue(nextDisplay);
        setInvalid(normalized === null);
        onValueChange(normalized ?? '');
      }}
      onFocus={(event) => {
        setFocused(true);
        setDisplayValue(formatMoneyInput(value, locale, false));
        onFocus?.(event);
      }}
      type="text"
      value={displayValue}
    />
  );
}
