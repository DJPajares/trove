'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { COUNTRY_CODES } from '@trove/types/countries';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ComponentProps } from 'react';

import { cn } from '@/lib/utils';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from './ui/combobox';

type Country = {
  code: string;
  name: string;
};

/**
 * The countries, named in the reader's own language.
 *
 * `Intl.DisplayNames` owns the names, so nothing here is a hard-coded string
 * and the list sorts by the name the reader actually sees rather than by an
 * English one. A code the runtime cannot name is dropped rather than shown as
 * two letters nobody can search for.
 */
function useCountries(locale: string): Country[] {
  return useMemo(() => {
    const displayNames = new Intl.DisplayNames(locale, { type: 'region' });
    const collator = new Intl.Collator(locale);

    return COUNTRY_CODES.flatMap((code) => {
      const name = displayNames.of(code);

      return name && name !== code ? [{ code, name }] : [];
    }).sort((left, right) => collator.compare(left.name, right.name));
  }, [locale]);
}

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
        className={cn(
          'h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background py-2 text-base shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-standard)] outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20',
          className,
        )}
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
            <ComboboxItem
              className="relative flex min-h-10 w-full cursor-default items-center gap-3 rounded-[var(--radius-sm)] py-2 pr-9 pl-3 text-sm outline-none select-none data-highlighted:bg-secondary data-highlighted:text-secondary-foreground"
              key={item.code}
              value={item}
            >
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
