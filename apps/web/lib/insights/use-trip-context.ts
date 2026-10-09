'use client';
import { useLocale } from 'next-intl';
import { queryKeys } from '@/lib/query/keys';
import { useWeatherQuery } from '@/lib/weather/use-weather-query';
/** Shared local seasonal evidence with separately retained trip/holiday metadata. */
export function useTripContext(tripId: string | null) {
  const language = useLocale();
  const query = useWeatherQuery(
    queryKeys.tripContext(tripId ?? '', language),
    (service) => service.context(tripId!, language),
    Boolean(tripId),
  );
  return query.data ?? null;
}
