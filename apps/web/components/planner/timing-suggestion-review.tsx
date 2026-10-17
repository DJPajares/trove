'use client';

import type { SchedulingOutcome, TimingChange, TimingReviewProposal } from '@trove/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { usePreferences } from '@/components/preferences-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import {
  applyItineraryTimingReview,
  fetchItineraryTimingReview,
  ItineraryApiError,
  saveItineraryTimingReview,
  type Itinerary,
} from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { withItineraryEdit } from '@/lib/itinerary/edit-lifecycle';
import { queryKeys } from '@/lib/query/keys';
import { invalidateTripQueries, ITINERARY_EDIT_QUERY_ROOTS } from '@/lib/query/trip-invalidation';

/** A dependent suggestion is one atomic decision, with every changed time visible. */
export function TimingSuggestionReview({
  proposal,
  tripId,
  onClose,
  onApplied,
}: Readonly<{
  proposal: TimingReviewProposal;
  tripId: string;
  onClose: () => void;
  onApplied: (outcome: SchedulingOutcome, applied: TimingChange[]) => void | Promise<void>;
}>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const review = useQuery({
    queryKey: queryKeys.itineraryTimingRepair(tripId, proposal),
    queryFn: ({ signal }) => fetchItineraryTimingReview(tripId, proposal, signal),
    enabled: online,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });
  const saved = client.getQueryData<Itinerary>(queryKeys.itinerary(tripId));
  const items = saved?.days.flatMap((day) => day.items) ?? [];
  const range = (slot: TimingChange['before']) =>
    slot.localTime
      ? [slot.localTime, slot.localEndTime]
          .filter((time): time is string => Boolean(time))
          .map((time) => formatSuggestedClock(time, locale, preferences.timeFormat === '12h'))
          .join('–')
      : t('connectedTiming.untimed');
  const changes = review.data?.changes ?? [];
  const currentProposal = review.data?.proposals?.[0];

  async function apply() {
    if (!online || saving || needsRefresh || !currentProposal || !changes.length) return;
    setSaving(true);
    setError(null);
    try {
      await withItineraryEdit(client, tripId, async () => {
        const result = await applyItineraryTimingReview(
          tripId,
          currentProposal,
          changes.map((row) => row.itemId),
        );
        await saveItineraryTimingReview(tripId, result.scheduling);
        await invalidateTripQueries(client, tripId, ITINERARY_EDIT_QUERY_ROOTS);
        await onApplied(result.scheduling, result.applied);
      });
      onClose();
    } catch (cause) {
      setError(
        t(
          cause instanceof ItineraryApiError && cause.status === 409
            ? 'connectedTiming.staleReview'
            : 'connectedTiming.applyError',
        ),
      );
      setNeedsRefresh(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent
        closeLabel={t('close')}
        className="w-full md:data-[side=right]:w-[min(32rem,calc(100%-0.5rem))]"
      >
        <SheetHeading
          title={t('connectedTiming.repairTitle')}
          description={t('connectedTiming.repairHint')}
        />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {!online || review.isPending || review.isFetching ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t(!online ? 'connectedTiming.onlineReview' : 'connectedTiming.loadingReview')}
            </p>
          ) : null}
          {error || review.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {error ?? t('connectedTiming.loadError')}
            </p>
          ) : null}
          {needsRefresh || review.isError ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!online || review.isFetching}
              onClick={() => {
                setError(null);
                void review.refetch().then((result) => {
                  if (result.isSuccess) setNeedsRefresh(false);
                });
              }}
            >
              {t('connectedTiming.refreshReview')}
            </Button>
          ) : null}
          {review.isSuccess && !review.isFetching ? (
            changes.length ? (
              <ul className="divide-y divide-border-subtle">
                {changes.map((change) => {
                  const item = items.find((row) => row.id === change.itemId);
                  const name =
                    item?.customLabel ??
                    item?.tripPlace?.customName ??
                    item?.tripPlace?.place.name ??
                    item?.tripPlace?.place.snapshot?.name ??
                    item?.tripPlace?.place.providerLabel ??
                    t('connectedTiming.stop');
                  return (
                    <li key={change.itemId} className="space-y-3 py-4 first:pt-0">
                      <h3 className="text-sm font-medium">{name}</h3>
                      {item && item.timingFlexibility !== 'flexible' ? (
                        <p className="text-xs text-muted-foreground">
                          {t('connectedTiming.repairFixed')}
                        </p>
                      ) : null}
                      <dl className="grid grid-cols-2 gap-4 text-sm tabular-nums">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            {t('connectedTiming.currentTime')}
                          </dt>
                          <dd className="mt-1 text-muted-foreground">{range(change.before)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            {t('connectedTiming.suggestedTime')}
                          </dt>
                          <dd className="mt-1 font-medium">{range(change.after)}</dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {t(
                  review.data?.issues.some((issue) => issue.severity === 'conflict')
                    ? 'suggestedTime.none'
                    : 'connectedTiming.noChanges',
                )}
              </p>
            )
          ) : null}
        </div>
        <SheetFooter className="sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            aria-busy={saving}
            disabled={
              !online ||
              saving ||
              needsRefresh ||
              !review.isSuccess ||
              review.isFetching ||
              !changes.length
            }
            onClick={() => void apply()}
          >
            {saving
              ? t('connectedTiming.applying')
              : changes.length
                ? t('connectedTiming.repairApply', { count: changes.length })
                : t('connectedTiming.repairApplyGeneric')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
