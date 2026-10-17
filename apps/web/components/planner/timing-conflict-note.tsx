'use client';

import type { SchedulingOutcome, TimingIssue } from '@trove/types';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { usePreferences } from '@/components/preferences-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { AttentionNote } from '@/components/planner/attention-note';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ItineraryApiError, updateItineraryItem, type ItineraryItem } from '@/lib/itinerary/api';
import {
  describeSuggestedTime,
  describeSuggestedTimeLimitation,
  formatSuggestedClock,
} from '@/lib/itinerary/day-time-suggestions';
import { withItineraryEdit } from '@/lib/itinerary/edit-lifecycle';
import { describeTimingIssue } from '@/lib/itinerary/timing-issue-description';

export function TimingConflictNote({
  issue,
  item,
  tripId,
  scheduleRevision,
  nameFor,
  onReview,
  onMove,
  onSaved,
}: Readonly<{
  issue: TimingIssue;
  item: ItineraryItem;
  tripId: string;
  scheduleRevision?: string;
  nameFor: (id: string) => string;
  onReview: () => void;
  onMove: () => void;
  onSaved: (outcome?: SchedulingOutcome) => Promise<void>;
}>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slot = issue.suggestion;
  const applicable =
    online &&
    !item.timingProtected &&
    scheduleRevision &&
    slot?.status === 'ok' &&
    slot.localTime &&
    slot.localEndTime &&
    slot.durationMinutes &&
    !slot.affectedItemIds?.length;

  const detail =
    slot?.status === 'ok'
      ? describeSuggestedTimeLimitation(slot, t)
      : slot
        ? describeSuggestedTime(slot, t)
        : '';

  async function apply() {
    if (!applicable || !slot || saving) return;
    setSaving(true);
    setError(null);
    try {
      await withItineraryEdit(client, tripId, async () => {
        const result = await updateItineraryItem(tripId, item.id, {
          schedule: { kind: 'exact', localTime: slot.localTime! },
          durationMinutes: slot.durationMinutes,
          localEndTime: null,
          timingFlexibility: item.timingFlexibility,
          timeProvenance: 'app_estimated',
          durationProvenance: slot.durationProvenance,
          scheduleRevision,
          timingPolicy: 'review_flexible',
        });
        await onSaved(result.scheduling);
      });
    } catch (cause) {
      setError(
        t(
          cause instanceof ItineraryApiError && cause.status === 409
            ? 'connectedTiming.staleReview'
            : 'connectedTiming.applyError',
        ),
      );
      await client.invalidateQueries({ queryKey: ['itinerary-timing', tripId] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AttentionNote
      className={
        issue.severity === 'conflict' ? 'bg-destructive/8 [&_svg]:text-destructive' : undefined
      }
    >
      <span className="sr-only">{t(`connectedTiming.issueLabel.${issue.severity}`)}: </span>
      {describeTimingIssue(issue, { locale, hour12: preferences.timeFormat === '12h', nameFor, t })}
      {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {applicable ? (
          <Button
            disabled={saving}
            onClick={() => void apply()}
            size="sm"
            type="button"
            variant="secondary"
          >
            {saving
              ? t('connectedTiming.applying')
              : t('connectedTiming.useTime', {
                  start: formatSuggestedClock(
                    slot.localTime!,
                    locale,
                    preferences.timeFormat === '12h',
                  ),
                  end: formatSuggestedClock(
                    slot.localEndTime!,
                    locale,
                    preferences.timeFormat === '12h',
                  ),
                })}
          </Button>
        ) : null}
        <Button
          disabled={saving}
          className="h-auto px-0 text-sm"
          onClick={onReview}
          type="button"
          variant="link"
        >
          {t('connectedTiming.reviewTiming')}
        </Button>
        {issue.severity === 'conflict' ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t('connectedTiming.moreOptions')}
                  disabled={saving}
                  size="icon-sm"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontal aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={onMove}>{t('planner.move.menuItem')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2" role="alert">
          {error}
        </p>
      ) : null}
    </AttentionNote>
  );
}
