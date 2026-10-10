'use client';
import type { SchedulingOutcome } from '@trove/types';
import { Clock3 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { usePreferences } from '@/components/preferences-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
export function TimingReviewNotice({
  outcome,
  nameFor,
  pending,
}: Readonly<{
  outcome: SchedulingOutcome | null;
  nameFor: (id: string) => string;
  pending: boolean;
}>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const range = (slot: { localTime: string | null; localEndTime: string | null }) =>
    slot.localTime
      ? `${formatSuggestedClock(slot.localTime, locale, preferences.timeFormat === '12h')}${slot.localEndTime ? `–${formatSuggestedClock(slot.localEndTime, locale, preferences.timeFormat === '12h')}` : ''}`
      : t('connectedTiming.untimed');
  if (!pending && !outcome?.changes.length && !outcome?.issues.length) return null;
  return (
    <>
      <Alert role="status" variant="info">
        <Clock3 aria-hidden="true" />
        <AlertDescription>
          <span>
            {t(
              pending
                ? 'connectedTiming.pending'
                : outcome?.changes.length
                  ? 'connectedTiming.changed'
                  : 'connectedTiming.needsReview',
            )}
          </span>
          {!pending ? (
            <Button
              className="ml-2"
              onClick={() => setOpen(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t('connectedTiming.review')}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent closeLabel={t('close')}>
          <SheetHeader>
            <SheetTitle>{t('connectedTiming.review')}</SheetTitle>
            <SheetDescription>
              {t(
                outcome?.changes.length
                  ? 'connectedTiming.reviewHint'
                  : 'connectedTiming.reviewUnresolvedHint',
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <ul className="divide-y">
              {outcome?.changes.map((change) => (
                <li className="py-3" key={`${change.itineraryDayId}:${change.itemId}`}>
                  <p className="text-sm font-medium">{nameFor(change.itemId)}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                    {range(change.before)} → {range(change.after)}
                  </p>
                </li>
              ))}
              {outcome?.issues.map((issue, index) => (
                <li className="py-3" key={`${issue.itemId}:${issue.code}:${index}`}>
                  <p className="text-sm font-medium">{nameFor(issue.itemId)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(`connectedTiming.issue.${issue.code}`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
