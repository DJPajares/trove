'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';

export type SearchSelectOption = { hint?: string | null; label: string; value: string };

/**
 * One searchable choice from a known list - a trip place, an itinerary stop, a
 * time zone. Clearing it is choosing nothing, so an optional link never needs
 * a "None" row: the placeholder says what an empty field means.
 */
export function SearchSelect({
  'aria-describedby': describedBy,
  id,
  label,
  onValueChange,
  options,
  placeholder,
  value,
}: Readonly<{
  'aria-describedby'?: string;
  id: string;
  label: string;
  onValueChange: (value: string) => void;
  options: readonly SearchSelectOption[];
  placeholder: string;
  value: string;
}>) {
  const t = useTranslations('reservations.picker');
  const filter = ComboboxPrimitive.useFilter({ sensitivity: 'base' });
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  return (
    <Combobox
      filter={(option: SearchSelectOption, query) =>
        filter.contains(option, query, (item: SearchSelectOption) => item.label) ||
        filter.contains(option, query, (item: SearchSelectOption) => item.hint ?? '')
      }
      items={options as SearchSelectOption[]}
      itemToStringLabel={(option: SearchSelectOption) => option.label}
      onValueChange={(option: SearchSelectOption | null) => onValueChange(option?.value ?? '')}
      value={selected}
    >
      <ComboboxInput
        aria-describedby={describedBy}
        aria-label={label}
        className="h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background text-base shadow-[var(--shadow-control)] outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 md:text-sm dark:bg-input/20"
        clearLabel={t('clear', { label })}
        id={id}
        placeholder={placeholder}
        showClear
        triggerLabel={t('open', { label })}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t('empty')}</ComboboxEmpty>
        <ComboboxList>
          {(option: SearchSelectOption) => (
            <ComboboxItem
              className="min-h-11 flex-col items-start justify-center gap-0 rounded-[var(--radius-sm)] py-2 pr-9 pl-3"
              key={option.value}
              value={option}
            >
              <span className="w-full truncate text-sm">{option.label}</span>
              {option.hint ? (
                <span className="w-full truncate text-xs text-muted-foreground">{option.hint}</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** Every IANA zone the device knows, labelled for people, with its current offset. */
export function timeZoneOptions(locale: string, now = new Date()): SearchSelectOption[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return zones.map((zone) => {
    let offset: string | null = null;
    try {
      offset =
        new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' })
          .formatToParts(now)
          .find((part) => part.type === 'timeZoneName')?.value ?? null;
    } catch {
      offset = null;
    }
    return {
      hint: offset ? `${offset} · ${zone}` : zone,
      label: zone.replaceAll('_', ' '),
      value: zone,
    };
  });
}
