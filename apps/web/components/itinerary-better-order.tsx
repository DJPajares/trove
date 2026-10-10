'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  fetchDayBetterOrder,
  organizeItineraryItem,
  type DayBetterOrder,
  type ItineraryDay,
  type ItineraryItem,
} from '@/lib/itinerary/api';
import { reorderMoves } from '@/lib/itinerary/better-order';

type Props = {
  day: ItineraryDay | null;
  itemName: (item: ItineraryItem) => string;
  onApplied: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  tripId: string;
};

/**
 * Shows the order Plan Score found for a day before anything changes, and
 * reorders only on Apply (PRD 29.4). The order and the hours check are read
 * from stored evidence, so previewing costs no provider request.
 */
export function ItineraryBetterOrder({
  day,
  itemName,
  onApplied,
  onOpenChange,
  tripId,
}: Readonly<Props>) {
  const t = useTranslations('itinerary.betterOrder');
  const [status, setStatus] = useState<'applying' | 'error' | 'loading' | 'ready'>('loading');
  const [proposal, setProposal] = useState<DayBetterOrder | null>(null);

  useEffect(() => {
    if (!day) return;
    const controller = new AbortController();
    setStatus('loading');
    setProposal(null);
    void fetchDayBetterOrder(tripId, day.id, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setProposal(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [day, tripId]);

  const items = new Map(day?.items.map((item) => [item.id, item]));
  const ordered =
    proposal?.status === 'ok'
      ? proposal.order.flatMap((id) => {
          const item = items.get(id);
          return item ? [item] : [];
        })
      : [];

  async function apply() {
    if (!day || proposal?.status !== 'ok') return;
    setStatus('applying');
    try {
      const moves = reorderMoves(
        day.items.map((item) => item.id),
        proposal.order,
      );
      for (const [index, move] of moves.entries()) {
        await organizeItineraryItem(tripId, move.itemId, {
          itineraryDayId: day.id,
          position: move.position,
          timingPolicy: index === moves.length - 1 ? 'reconcile_flexible' : 'preserve',
        });
      }
      await onApplied();
      onOpenChange(false);
    } catch {
      setStatus('error');
    }
  }

  const hoursNote =
    proposal?.status === 'ok'
      ? proposal.conflictsAfter < proposal.conflictsBefore
        ? t('fixesHours', { count: proposal.conflictsBefore - proposal.conflictsAfter })
        : proposal.conflictsAfter > proposal.conflictsBefore
          ? t('createsHours', { count: proposal.conflictsAfter - proposal.conflictsBefore })
          : null
      : null;

  return (
    <Sheet onOpenChange={onOpenChange} open={day !== null}>
      <SheetContent closeLabel={t('close')}>
        <SheetHeader className="border-b">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {status === 'loading' ? (
            <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
              {t('loading')}
            </p>
          ) : status === 'error' ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('error')}</AlertDescription>
            </Alert>
          ) : proposal?.status !== 'ok' ? (
            <p className="text-sm text-muted-foreground">{t('none')}</p>
          ) : (
            <>
              <p className="text-sm font-medium">
                {t('saves', { minutes: proposal.plannedMinutes - proposal.bestMinutes })}
              </p>
              {hoursNote ? (
                <p
                  className={
                    proposal.conflictsAfter > proposal.conflictsBefore
                      ? 'text-sm font-medium text-status-warning'
                      : 'text-sm text-muted-foreground'
                  }
                >
                  {hoursNote}
                </p>
              ) : null}
              <ol className="space-y-2">
                {ordered.map((item, index) => (
                  <li className="flex items-center gap-3 text-sm" key={item.id}>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate">{itemName(item)}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">{t('estimate')}</p>
            </>
          )}
        </div>
        <SheetFooter className="sm:flex-row sm:justify-end">
          <Button
            disabled={status === 'applying'}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {t('cancel')}
          </Button>
          <Button
            disabled={status !== 'ready' || proposal?.status !== 'ok'}
            onClick={() => void apply()}
            type="button"
          >
            {status === 'applying' ? t('applying') : t('apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
