'use client';

import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { usePreferences } from '@/components/preferences-provider';
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
import { Switch } from '@/components/ui/switch';
import {
  fetchItineraryDayTimeSuggestions,
  updateItineraryItem,
  type ItineraryDay,
  type ItineraryItem,
} from '@/lib/itinerary/api';
import {
  defaultSelection,
  describeSuggestedTime,
  formatSuggestedClock,
  isApplicable,
  orderedUpdates,
  untimedItems,
  type DayTimeRow,
  type ItineraryTranslator,
} from '@/lib/itinerary/day-time-suggestions';

type Props = {
  day: ItineraryDay;
  itemName: (item: ItineraryItem) => string;
  onApplied: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tripId: string;
};

/**
 * Proposes a time for every untimed stop on a day at once. Nothing is saved
 * until the traveller applies it, and they can leave out any stop (PRD 29.4:
 * Save is the mutation boundary). The proposals come from stored evidence only.
 */
export function ItineraryDayTimeSuggestions({
  day,
  itemName,
  onApplied,
  onOpenChange,
  open,
  tripId,
}: Readonly<Props>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [status, setStatus] = useState<'applying' | 'error' | 'loading' | 'ready'>('loading');
  const [rows, setRows] = useState<DayTimeRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const describe = t as unknown as ItineraryTranslator;

  const untimed = useMemo(() => untimedItems(day), [day]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatus('loading');
    void fetchItineraryDayTimeSuggestions(tripId, day.id, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        const byItem = new Map(response.suggestions.map((entry) => [entry.itemId, entry]));
        const next = untimed.flatMap((item): DayTimeRow[] => {
          const suggestion = byItem.get(item.id);
          return suggestion ? [{ itemId: item.id, name: itemName(item), suggestion }] : [];
        });
        setRows(next);
        setSelected(defaultSelection(next));
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
    // The day is re-read each time the sheet opens; later edits must not refetch it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tripId, day.id]);

  async function apply() {
    setStatus('applying');
    try {
      // Earliest first, so the day settles into its order in one pass.
      for (const update of orderedUpdates(rows, selected)) {
        await updateItineraryItem(tripId, update.itemId, {
          schedule: { kind: 'exact', localTime: update.localTime },
        });
      }
      await onApplied();
      onOpenChange(false);
    } catch {
      setStatus('error');
    }
  }

  const applicable = rows.filter(isApplicable);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent closeLabel={t('close')}>
        <SheetHeader className="border-b">
          <SheetTitle>{t('dayTimes.title')}</SheetTitle>
          <SheetDescription>{t('dayTimes.description')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {status === 'loading' ? (
            <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
              {t('dayTimes.loading')}
            </p>
          ) : status === 'error' ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('dayTimes.error')}</AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dayTimes.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const canApply = isApplicable(row);
                const localTime = row.suggestion.localTime;
                return (
                  <li className="flex items-start justify-between gap-4 py-3" key={row.itemId}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {canApply && localTime
                          ? `${formatSuggestedClock(localTime, locale, preferences.timeFormat === '12h')} · `
                          : ''}
                        {describeSuggestedTime(row.suggestion, describe)}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('dayTimes.include', { name: row.name })}
                      checked={canApply && selected.has(row.itemId)}
                      disabled={!canApply || status === 'applying'}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.itemId);
                          else next.delete(row.itemId);
                          return next;
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
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
            disabled={status !== 'ready' || selected.size === 0 || applicable.length === 0}
            onClick={() => void apply()}
            type="button"
          >
            {status === 'applying' ? t('dayTimes.applying') : t('dayTimes.apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
