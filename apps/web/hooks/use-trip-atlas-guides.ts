'use client';

import { useQueries } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { fetchAtlasGuide } from '@/lib/atlas/api';
import {
  TRIP_ATLAS_MAX_COUNTRIES,
  townAtlasGuide,
  type TripAtlasGuide,
} from '@/lib/atlas/trip-guides';
import { queryKeys } from '@/lib/query/keys';

/**
 * Atlas guides for a trip's countries and the towns in its journey (PRD 40.5).
 * Reads Trove's shared guide copies, the same queries Atlas itself uses, so a
 * trip screen never reaches Google and a guide read once is not read again.
 */
export function useTripAtlasGuides(countryCodes: readonly string[] | null | undefined) {
  const locale = useLocale();
  const index = useAtlasIndex();
  const codes = useMemo(() => {
    const known = new Set(index.data?.countries.map((country) => country.countryCode));
    return [...new Set((countryCodes ?? []).map((code) => code.toUpperCase()))]
      .filter((code) => known.has(code))
      .slice(0, TRIP_ATLAS_MAX_COUNTRIES);
  }, [countryCodes, index.data]);

  const destinationLists = useQueries({
    combine: (results) => results.map((result) => result.data?.destinations),
    queries: codes.map((countryCode) => ({
      queryFn: () => fetchAtlasGuide(countryCode),
      queryKey: queryKeys.atlasGuide(countryCode),
      retry: 1,
      staleTime: 24 * 60 * 60 * 1_000,
    })),
  });

  const countries = useMemo<TripAtlasGuide[]>(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return codes.map((countryCode) => ({
      countryCode,
      href: `/atlas/${countryCode}`,
      kind: 'country',
      name: names.of(countryCode) ?? countryCode,
    }));
  }, [codes, locale]);

  const destinationSets = useMemo(
    () =>
      codes.map((countryCode, position) => ({
        countryCode,
        destinations: destinationLists[position] ?? [],
      })),
    [codes, destinationLists],
  );

  const guideForTown = useCallback(
    (town: string) => townAtlasGuide(town, destinationSets),
    [destinationSets],
  );

  return { countries, guideForTown };
}
