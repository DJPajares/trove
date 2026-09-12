'use client';

import { countryFlagEmoji, COUNTRY_CODES } from '@trove/types/countries';
import { useMemo } from 'react';

export type Country = {
  code: string;
  /** The country's flag, or an empty string for a code with none. */
  flag: string;
  name: string;
};

/**
 * The countries, named in the reader's own language.
 *
 * `Intl.DisplayNames` owns the names, so nothing here is a hard-coded string
 * and the list sorts by the name the reader actually sees rather than by an
 * English one. A code the runtime cannot name is dropped rather than shown as
 * two letters nobody can search for.
 *
 * Shared by the single-select home-country field and the multi-select trip one,
 * because two pickers over one list that disagreed about its order or its
 * spelling would be worse than either.
 */
export function useCountries(locale: string): Country[] {
  return useMemo(() => {
    const displayNames = new Intl.DisplayNames(locale, { type: 'region' });
    const collator = new Intl.Collator(locale);

    return COUNTRY_CODES.flatMap((code) => {
      const name = displayNames.of(code);

      return name && name !== code ? [{ code, flag: countryFlagEmoji(code), name }] : [];
    }).sort((left, right) => collator.compare(left.name, right.name));
  }, [locale]);
}
