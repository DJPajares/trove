'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ComponentProps } from 'react';

import { useCountries, type Country } from '@/hooks/use-countries';
import { cn } from '@/lib/utils';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from './ui/combobox';

type CountryMultiComboboxProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  id: string;
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  required?: boolean;
  /** ISO 3166-1 alpha-2 codes, in the order the traveller picked them. */
  value: string[];
};

/**
 * The countries a trip visits.
 *
 * A trip may span several without becoming several trips, so this is the
 * multi-select twin of the home-country field and shares its list: one set of
 * names, one order, one spelling. Selection order is kept rather than sorted,
 * because the order a traveller names countries in is usually the order they
 * will visit them.
 *
 * Built from the chips parts `ui/combobox` has exported since it was written
 * and nothing had yet used - Base UI's own multi-select path, already wrapped
 * in Trove's styling, down to the popup's `data-chips` branch.
 */
export function CountryMultiCombobox({
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
}: Readonly<CountryMultiComboboxProps>) {
  const t = useTranslations('travelInputs.country');
  const locale = useLocale();
  const countries = useCountries(locale);
  const anchor = useComboboxAnchor();
  // The field shows each country's name, but a traveller who knows the
  // two-letter code should be able to type it, so both halves stay searchable.
  const filter = ComboboxPrimitive.useFilter({ sensitivity: 'base' });
  const selected = useMemo(() => {
    const byCode = new Map(countries.map((country) => [country.code, country]));

    return value.flatMap((code) => byCode.get(code.trim().toUpperCase()) ?? []);
  }, [countries, value]);

  return (
    <Combobox
      disabled={disabled}
      filter={(country, query) =>
        filter.contains(country, query, (item: Country) => item.name) ||
        filter.contains(country, query, (item: Country) => item.code)
      }
      items={countries}
      itemToStringLabel={(country) => country.name}
      multiple
      onValueChange={(countries: Country[]) => onValueChange(countries.map((item) => item.code))}
      value={selected}
    >
      <ComboboxChips
        className={cn(
          'min-h-11 w-full rounded-[var(--radius-md)] bg-background py-1.5 shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-standard)] hover:border-border-strong has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:bg-muted has-disabled:opacity-60 dark:bg-input/20',
          className,
        )}
        ref={anchor}
      >
        {selected.map((country) => (
          // No value prop: Base UI matches a chip to the selection by its index
          // in the composite list, so the chips must simply be rendered in the
          // same order as the value they came from.
          <ComboboxChip key={country.code} removeLabel={t('remove', { label: country.name })}>
            <span aria-hidden="true">{country.flag}</span>
            {country.name}
          </ComboboxChip>
        ))}
        <ComboboxChipsInput
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-required={required}
          id={id}
          placeholder={selected.length ? undefined : placeholder}
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>{t('empty')}</ComboboxEmpty>
        <ComboboxList>
          {(item: Country) => (
            <ComboboxItem
              className="relative flex min-h-10 w-full cursor-default items-center gap-3 rounded-[var(--radius-sm)] py-2 pr-9 pl-3 text-sm outline-none select-none data-highlighted:bg-secondary data-highlighted:text-secondary-foreground"
              key={item.code}
              value={item}
            >
              <span aria-hidden="true">{item.flag}</span>
              {item.name}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
