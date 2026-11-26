'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchAtlasIndex } from '@/lib/atlas/api';
import { queryKeys } from '@/lib/query/keys';

/**
 * Atlas's countries and their typical conditions. Shared reference data that
 * changes about once a year, so a copy on the device is good for a day and
 * keeps Atlas browsable offline.
 */
export function useAtlasIndex() {
  return useQuery({
    queryFn: fetchAtlasIndex,
    queryKey: queryKeys.atlasIndex(),
    staleTime: 24 * 60 * 60 * 1_000,
  });
}
