'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import {
  createItineraryItem,
  fetchDayGapSuggestions,
  type ItineraryTripPlace,
} from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { queryKeys } from '@/lib/query/keys';

type Props = {
  dayId: string;
  onAdded: () => Promise<void>;
  placeName: (tripPlace: ItineraryTripPlace) => string;
  tripId: string;
  tripPlaces: readonly ItineraryTripPlace[];
};

/**
 * A day's free stretches between stops, each with up to three of the
 * traveller's own unplanned places that fit, with why. Stored data only, and
 * nothing is added until the traveller taps (PRD 29.4).
 */
export function ItineraryGapSuggestions({
  dayId,
  onAdded,
  placeName,
  tripId,
  tripPlaces,
}: Readonly<Props>) {
  const t = useTranslations('itinerary.gaps');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    enabled: online,
    queryFn: ({ signal }) => fetchDayGapSuggestions(tripId, dayId, { signal }),
    queryKey: queryKeys.gapSuggestions(tripId, dayId),
    retry: false,
  });

  const byPlace = new Map(tripPlaces.map((tripPlace) => [tripPlace.id, tripPlace]));
  const gaps = query.data?.gaps ?? [];
  if (!gaps.length) return null;
  const clock = (time: string) =>
    formatSuggestedClock(time, locale, preferences.timeFormat === '12h');

  async function add(tripPlaceId: string, startTime: string, visitMinutes: number) {
    setBusy(tripPlaceId);
    setFailed(false);
    try {
      await createItineraryItem(tripId, {
        durationMinutes: visitMinutes,
        itineraryDayId: dayId,
        schedule: { kind: 'exact', localTime: startTime },
        tripPlaceId,
      });
      await onAdded();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby={`itinerary-gaps-${dayId}`} className="space-y-3 px-1 py-4">
      <h2 className="text-base font-semibold" id={`itinerary-gaps-${dayId}`}>
        {t('title')}
      </h2>
      {failed ? (
        <p className="text-sm text-status-danger" role="alert">
          {t('error')}
        </p>
      ) : null}
      {gaps.map((gap) => (
        <div className="space-y-2" key={`${gap.afterItemId}:${gap.beforeItemId}`}>
          <p className="text-sm text-muted-foreground">
            {t('free', { end: clock(gap.endTime), start: clock(gap.startTime) })}
          </p>
          <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {gap.suggestions.map((suggestion) => {
              const tripPlace = byPlace.get(suggestion.tripPlaceId);
              if (!tripPlace) return null;
              const name = placeName(tripPlace);
              const why = suggestion.reasons.filter((reason) => reason !== 'NEAR_ROUTE');
              return (
                <li
                  className="flex items-start justify-between gap-3 p-3"
                  key={suggestion.tripPlaceId}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        t('at', { time: clock(suggestion.startTime) }),
                        t('detour', { minutes: suggestion.detourMinutes }),
                        ...why.map((reason) => t(`reason.${reason}`)),
                      ].join(' · ')}
                    </p>
                    {suggestion.hoursUnknown ? (
                      <p className="text-xs text-status-warning">{t('hoursUnknown')}</p>
                    ) : null}
                  </div>
                  <Button
                    aria-label={t('add', { name, time: clock(suggestion.startTime) })}
                    disabled={busy !== null}
                    onClick={() =>
                      void add(
                        suggestion.tripPlaceId,
                        suggestion.startTime,
                        suggestion.visitMinutes,
                      )
                    }
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
