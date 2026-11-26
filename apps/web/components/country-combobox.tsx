'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ComponentProps } from 'react';

import { useCountries, type Country } from '@/hooks/use-countries';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox';

type CountryComboboxProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  id: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
};

export function CountryCombobox({
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  className,
  disabled,
  id,
  onValueChange,
  placeholder,
  required,
  value,
}: Readonly<CountryComboboxProps>) {
  const t = useTranslations('travelInputs.country');
  const locale = useLocale();
  const countries = useCountries(locale);
  // The field shows the country's name, but a traveller who knows the two-letter
  // code should be able to type it, so both halves stay searchable.
  const filter = ComboboxPrimitive.useFilter({ sensitivity: 'base' });
  const code = value.trim().toUpperCase();
  const selected = useMemo(
    () => countries.find((country) => country.code === code) ?? null,
    [code, countries],
  );

  return (
    <Combobox
      items={countries}
      filter={(country, query) =>
        filter.contains(country, query, (item: Country) => item.name) ||
        filter.contains(country, query, (item: Country) => item.code)
      }
      itemToStringLabel={(country) => country.name}
      value={selected}
      onValueChange={(country) => onValueChange(country?.code ?? '')}
      disabled={disabled}
    >
      <ComboboxInput
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-required={required}
        className={className}
        clearLabel={t('clear', { label: ariaLabel })}
        id={id}
        placeholder={placeholder}
        required={required}
        showClear
        triggerLabel={t('open', { label: ariaLabel })}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t('empty')}</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item.code} value={item}>
              <span aria-hidden="true">{item.flag}</span>
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
