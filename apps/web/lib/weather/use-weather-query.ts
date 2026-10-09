'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWeatherService } from './client-service';
import type { LocalWeatherService } from './service';
import { weatherQueryStaleTime } from './cache-policy';

/** One lifecycle for weather facades; persistence and SWR belong to the service. */
export function useWeatherQuery<T extends { refreshAfter?: number }>(
  key: readonly unknown[],
  read: (service: LocalWeatherService) => Promise<T>,
  enabled = true,
) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: () => read(getWeatherService(client)),
    enabled,
    networkMode: 'always', // The query reads local evidence even offline; the service gates acquisition.
    staleTime: weatherQueryStaleTime,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const hash = JSON.stringify(key);
  useEffect(() => {
    if (!enabled) return;
    let service: LocalWeatherService;
    try {
      service = getWeatherService(client);
    } catch {
      return;
    }
    const refetch = () => {
      if (!document.hidden && navigator.onLine)
        void client.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
    };
    return service.subscribe((changedKey) => {
      if (service.affects(key, changedKey)) refetch();
    });
    // Key content, rather than the newly allocated array, determines subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hash, enabled]);
  useEffect(() => {
    const deadline = query.data?.refreshAfter;
    if (!enabled || deadline === undefined || !Number.isFinite(deadline)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (document.hidden || !navigator.onLine) return;
      timer = setTimeout(
        () => {
          if (!document.hidden && navigator.onLine) void query.refetch({ cancelRefetch: false });
        },
        Math.min(2_147_483_647, Math.max(1_000, deadline - Date.now())),
      );
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('online', schedule);
      window.removeEventListener('offline', schedule);
    };
  }, [enabled, query.data?.refreshAfter, query.refetch]);
  return query;
}
