'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import { namedCountries } from '@/lib/trips/countries';

export type TripCountriesProps = {
  className?: string;
  /** ISO 3166-1 alpha-2, in the order the traveller picked them. */
  countries: readonly string[];
};

/**
 * Where a trip goes, said as flags and country names.
 *
 * Named in the reader's own language through `Intl.DisplayNames`, the same
 * source the country picker draws on, so the name a traveller chose from is the
 * name they are shown afterwards.
 *
 * Renders nothing at all for a trip with no countries. Every trip created
 * before the field existed is such a trip, and a placeholder there would be the
 * "Destination still open" mistake again - a line that fills the space without
 * saying anything.
 */
export function TripCountries({ className, countries }: Readonly<TripCountriesProps>) {
  const locale = useLocale();
  const named = useMemo(() => namedCountries(countries, locale), [countries, locale]);

  if (!named.length) return null;

  return (
    <span className={className}>
      {named.map((country, index) => (
        <span key={country.code}>
          {index > 0 ? <span aria-hidden="true">{' · '}</span> : null}
          <span aria-hidden="true">{country.flag} </span>
          {country.name}
        </span>
      ))}
    </span>
  );
}
