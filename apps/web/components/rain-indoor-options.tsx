'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { fetchRainAlternatives, updateItineraryItem } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { ITINERARY_EDIT_QUERY_ROOTS, invalidateTripQueries } from '@/lib/query/trip-invalidation';
import { formatNearbyDistance } from '@/lib/trip-places/signals';

/**
 * Under a rain insight: indoor places from the traveller's own list near each
 * outdoor stop the rain affects. A suggestion only - it is asked for by a tap,
 * read from stored data, and a stop changes only when the traveller swaps it
 * (PRD 29.4). Stops with a reservation are listed without a swap, since
 * replacing them needs review.
 */
export function RainIndoorOptions({ dayId, tripId }: Readonly<{ dayId: string; tripId: string }>) {
  const t = useTranslations('insights.rainIndoor');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    enabled: open,
    queryFn: ({ signal }) => fetchRainAlternatives(tripId, dayId, { signal }),
    queryKey: queryKeys.rainAlternatives(tripId, dayId),
    retry: false,
  });

  async function swap(stop: { itemId: string; retitleOnSwap: boolean }, tripPlaceId: string) {
    setBusy(tripPlaceId);
    setFailed(false);
    try {
      await updateItineraryItem(tripId, stop.itemId, {
        // A label that only repeated the old place's name would now be wrong.
        ...(stop.retitleOnSwap ? { customLabel: null } : {}),
        tripPlaceId,
      });
      await invalidateTripQueries(queryClient, tripId, ITINERARY_EDIT_QUERY_ROOTS);
      await queryClient.invalidateQueries({ queryKey: queryKeys.rainAlternatives(tripId, dayId) });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <Button
        className="h-auto px-0 text-sm"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="link"
      >
        {t('show')}
      </Button>
    );
  }

  const stops = query.data?.stops ?? [];
  return (
    <div className="space-y-3 pt-1">
      {query.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : query.isError ? (
        <p className="text-sm text-status-danger" role="alert">
          {t('error')}
        </p>
      ) : stops.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : null}
      {failed ? (
        <p className="text-sm text-status-danger" role="alert">
          {t('swapError')}
        </p>
      ) : null}
      {stops.map((stop) => (
        <div className="space-y-1.5" key={stop.itemId}>
          <p className="text-sm font-medium">{t('instead', { name: stop.name })}</p>
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {stop.alternatives.map((alternative) => (
              <li
                className="flex items-center justify-between gap-3 px-3 py-2"
                key={alternative.tripPlaceId}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{alternative.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      t('away', {
                        distance: formatNearbyDistance(
                          alternative.distanceKm * 1000,
                          preferences.distanceUnit,
                          locale,
                        ),
                      }),
                      alternative.hoursUnknown ? t('hoursUnknown') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {stop.swappable ? (
                  <Button
                    aria-label={t('swapFor', { name: alternative.name, stop: stop.name })}
                    disabled={busy !== null}
                    onClick={() => void swap(stop, alternative.tripPlaceId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {busy === alternative.tripPlaceId ? t('swapping') : t('swap')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {stop.swappable ? null : <p className="text-xs text-muted-foreground">{t('reserved')}</p>}
        </div>
      ))}
    </div>
  );
}
