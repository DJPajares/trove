'use client';

import type { SchedulingOutcome, TimingChange, TimingReviewProposal } from '@trove/types';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, CircleAlert, Clock3 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '@/components/preferences-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { acknowledgeTimingReview } from '@/lib/itinerary/timing-review-state';
import { describeTimingIssue } from '@/lib/itinerary/timing-issue-description';
import { withItineraryEdit } from '@/lib/itinerary/edit-lifecycle';
import {
  applyItineraryTimingReview,
  fetchItineraryTimingReview,
  saveItineraryTimingReview,
  ItineraryApiError,
} from '@/lib/itinerary/api';

type Props = {
  outcome: SchedulingOutcome | null;
  nameFor: (id: string) => string;
  dayLabelFor: (id: string) => string;
  dayLabelForItem: (id: string) => string;
  onOpenStop: (id: string) => void;
  onApplied: () => Promise<void>;
  pending: boolean;
  tripId: string;
};
const combine = (reviews: Record<string, SchedulingOutcome>): SchedulingOutcome => ({
  changes: Object.values(reviews).flatMap((r) => r.changes),
  issues: Object.values(reviews).flatMap((r) => r.issues),
  proposals: Object.values(reviews).flatMap((r) => r.proposals ?? []),
});

function TimingReviewBody({
  outcome,
  nameFor,
  dayLabelFor,
  dayLabelForItem,
  tripId,
  onApplied,
  onClose,
  onOpenStop,
}: Omit<Props, 'outcome' | 'pending'> & { outcome: SchedulingOutcome; onClose: () => void }) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const [reviews, setReviews] = useState<Record<string, SchedulingOutcome>>({});
  const [applied, setApplied] = useState<TimingChange[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applyingIds, setApplyingIds] = useState<string[]>([]);
  const proposed = Boolean(outcome.proposals?.length);
  const initial = useRef(outcome);
  const rowOrder = useRef(new Map(outcome.changes.map((change, index) => [change.itemId, index])));
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    const proposals = initial.current.proposals ?? [];
    if (!proposals.length) {
      setStatus('ready');
      return;
    }
    void Promise.all(
      proposals.map(
        async (proposal) =>
          [
            proposal.itineraryDayId,
            await fetchItineraryTimingReview(tripId, proposal, controller.signal),
          ] as const,
      ),
    )
      .then(async (entries) => {
        if (controller.signal.aborted) return;
        const next = Object.fromEntries(entries);
        setReviews(next);
        await saveItineraryTimingReview(tripId, combine(next));
        if (!controller.signal.aborted) setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(t('connectedTiming.loadError'));
          setStatus('error');
        }
      });
    return () => controller.abort();
  }, [attempt, online, tripId, t]);

  const current = proposed ? { ...combine(reviews), issues: outcome.issues } : outcome;
  const changes = [
    ...current.changes,
    ...applied.filter((row) => !current.changes.some((change) => change.itemId === row.itemId)),
  ].toSorted(
    (a, b) =>
      (rowOrder.current.get(a.itemId) ?? rowOrder.current.size) -
      (rowOrder.current.get(b.itemId) ?? rowOrder.current.size),
  );
  const remaining = current.changes.length;
  const canKeepCurrent = proposed && (remaining > 0 || status === 'error');
  const range = (slot: TimingChange['before']) =>
    slot.localTime
      ? `${formatSuggestedClock(slot.localTime, locale, preferences.timeFormat === '12h')}${slot.localEndTime ? `–${formatSuggestedClock(slot.localEndTime, locale, preferences.timeFormat === '12h')}` : ''}`
      : t('connectedTiming.untimed');

  async function apply(proposal: TimingReviewProposal, ids: string[]) {
    setApplyingIds(ids);
    setStatus('saving');
    setError(null);
    try {
      await withItineraryEdit(client, tripId, async () => {
        const result = await applyItineraryTimingReview(tripId, proposal, ids);
        const next = { ...reviews, [proposal.itineraryDayId]: result.scheduling };
        setReviews(next);
        initial.current = combine(next);
        setApplied((previous) => [...previous, ...result.applied]);
        await saveItineraryTimingReview(tripId, combine(next));
        await onApplied();
      });
      setStatus('ready');
    } catch (cause) {
      const group =
        cause instanceof ItineraryApiError && cause.code === 'itinerary_timing_group_required';
      setError(
        t(
          group
            ? 'connectedTiming.applyTogether'
            : cause instanceof ItineraryApiError && cause.status === 409
              ? 'connectedTiming.staleReview'
              : 'connectedTiming.applyError',
        ),
      );
      // Group conflicts leave this preview valid. Every other failure needs a
      // fresh review, including a response lost after a successful server write.
      setStatus(group ? 'ready' : 'error');
    }
  }
  async function discard() {
    setStatus('saving');
    try {
      await saveItineraryTimingReview(tripId, { changes: [], issues: [] });
      onClose();
    } catch {
      setError(t('connectedTiming.applyError'));
      setStatus('error');
    }
  }
  async function acknowledge() {
    // A proposal still loading has not been reviewed; closing preserves it.
    if (status !== 'ready') {
      onClose();
      return;
    }
    setStatus('saving');
    try {
      await saveItineraryTimingReview(tripId, acknowledgeTimingReview(current), {
        expected: outcome,
      });
      onClose();
    } catch {
      setError(t('connectedTiming.applyError'));
      setStatus('error');
    }
  }
  async function refreshReview() {
    setStatus('loading');
    try {
      // A failed response may follow a successful commit, or another edit may
      // have made the preview stale. Recover the saved itinerary as well.
      await onApplied();
      setApplied([]);
      setAttempt((value) => value + 1);
    } catch {
      setError(t('connectedTiming.loadError'));
      setStatus('error');
    }
  }
  const busy = status === 'saving';
  return (
    <>
      <SheetHeading
        title={t('connectedTiming.review')}
        description={t(
          proposed
            ? 'connectedTiming.proposalHint'
            : outcome.changes.length
              ? 'connectedTiming.reviewHint'
              : 'connectedTiming.reviewUnresolvedHint',
        )}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {!online ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('connectedTiming.onlineReview')}
          </p>
        ) : null}
        {status === 'loading' && online ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('connectedTiming.loadingReview')}
          </p>
        ) : null}
        {error ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {status === 'error' ? (
          <Button
            onClick={() => void refreshReview()}
            disabled={!online}
            size="sm"
            variant="outline"
          >
            {t('connectedTiming.refreshReview')}
          </Button>
        ) : null}
        {status !== 'loading' && (
          <>
            {proposed && !remaining ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t(
                  applied.length
                    ? 'connectedTiming.appliedConfirmation'
                    : 'connectedTiming.noChanges',
                )}
              </p>
            ) : null}
            <ul className="divide-y divide-border-subtle">
              {changes.map((change) => {
                const saved =
                  !proposed || !current.changes.some((row) => row.itemId === change.itemId);
                const proposal = current.proposals?.find(
                  (p) => p.itineraryDayId === change.itineraryDayId,
                );
                return (
                  <li className="space-y-3 py-4 first:pt-0" key={change.itemId}>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        {dayLabelFor(change.itineraryDayId)}
                      </p>
                      <h3 className="text-sm leading-5 font-medium">{nameFor(change.itemId)}</h3>
                    </div>
                    <dl className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t(
                            saved ? 'connectedTiming.previousTime' : 'connectedTiming.currentTime',
                          )}
                        </dt>
                        <dd className="mt-1 text-sm leading-5 tabular-nums text-muted-foreground">
                          {range(change.before)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t(
                            saved ? 'connectedTiming.currentTime' : 'connectedTiming.suggestedTime',
                          )}
                        </dt>
                        <dd className="mt-1 text-sm leading-5 font-medium tabular-nums">
                          {range(change.after)}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        className="-ml-2"
                        aria-label={t('connectedTiming.openStopNamed', {
                          name: nameFor(change.itemId),
                        })}
                        disabled={busy}
                        onClick={() => onOpenStop(change.itemId)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t('connectedTiming.openStop')}
                        <ArrowUpRight aria-hidden="true" />
                      </Button>
                      {saved ? (
                        <span className="flex items-center gap-1 text-xs text-status-success">
                          <Check aria-hidden="true" className="size-3.5" />
                          {t('connectedTiming.applied')}
                        </span>
                      ) : proposal ? (
                        <Button
                          aria-label={t('connectedTiming.applySuggestionFor', {
                            name: nameFor(change.itemId),
                          })}
                          aria-busy={busy && applyingIds.includes(change.itemId)}
                          disabled={!online || status !== 'ready'}
                          onClick={() => void apply(proposal, [change.itemId])}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {t(
                            busy && applyingIds.includes(change.itemId)
                              ? 'connectedTiming.applying'
                              : 'connectedTiming.applySuggestion',
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {current.issues.length ? (
              <ul className="space-y-3">
                {current.issues.map((issue, index) => (
                  <li className="space-y-1" key={`${issue.itemId}:${issue.code}:${index}`}>
                    <p className="text-xs text-muted-foreground">{dayLabelForItem(issue.itemId)}</p>
                    <p className="text-sm font-medium">{nameFor(issue.itemId)}</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {describeTimingIssue(issue, {
                        locale,
                        hour12: preferences.timeFormat === '12h',
                        nameFor,
                        t,
                      })}
                    </p>
                    <Button
                      className="-ml-2"
                      aria-label={t('connectedTiming.openStopNamed', {
                        name: nameFor(issue.itemId),
                      })}
                      disabled={busy}
                      onClick={() => onOpenStop(issue.itemId)}
                      size="sm"
                      variant="ghost"
                    >
                      {t('connectedTiming.openStop')}
                      <ArrowUpRight aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      <SheetFooter className="gap-3 px-5 py-4">
        {proposed && remaining > 1
          ? current.proposals?.map((proposal) => {
              const ids = current.changes
                .filter((c) => c.itineraryDayId === proposal.itineraryDayId)
                .map((c) => c.itemId);
              return ids.length > 1 ? (
                <Button
                  disabled={!online || status !== 'ready'}
                  key={proposal.itineraryDayId}
                  onClick={() => void apply(proposal, ids)}
                  type="button"
                >
                  {busy
                    ? t('connectedTiming.applying')
                    : t('connectedTiming.applyAll', { count: ids.length })}
                </Button>
              ) : null;
            })
          : null}
        <Button
          disabled={busy}
          onClick={() => void (canKeepCurrent ? discard() : acknowledge())}
          type="button"
          variant="outline"
        >
          {t(canKeepCurrent ? 'connectedTiming.keepCurrent' : 'connectedTiming.done')}
        </Button>
      </SheetFooter>
    </>
  );
}

export function TimingReviewNotice({ outcome, pending, ...props }: Readonly<Props>) {
  const t = useTranslations('itinerary');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const jumped = useRef<string | null>(null);
  const issueDays = [
    ...new Set(outcome?.issues.map((issue) => props.dayLabelForItem(issue.itemId)).filter(Boolean)),
  ];
  const visible = pending || Boolean(outcome?.changes.length || outcome?.issues.length);
  if (!visible && !open) return null;
  return (
    <>
      {visible ? (
        <Alert
          className="flex items-start gap-3 px-3 py-2.5 *:[svg]:shrink-0 *:[svg]:translate-y-0"
          role="status"
          variant="info"
        >
          <Clock3 aria-hidden="true" className="mt-1" />
          <AlertDescription className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span className="min-w-0 flex-1">
              {t(
                pending
                  ? 'connectedTiming.pending'
                  : outcome?.changes.length
                    ? outcome.proposals?.length
                      ? 'connectedTiming.suggestionsReady'
                      : 'connectedTiming.changed'
                    : issueDays.length === 1
                      ? 'connectedTiming.needsReviewForDay'
                      : 'connectedTiming.needsReview',
                { day: issueDays[0] ?? '' },
              )}
            </span>
            {!pending ? (
              <Button
                aria-haspopup="dialog"
                className="-my-1 -mr-1 px-2"
                onClick={() => {
                  jumped.current = null;
                  setOpen(true);
                }}
                ref={trigger}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('connectedTiming.review')}
                <ArrowUpRight aria-hidden="true" />
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next && jumped.current) props.onOpenStop(jumped.current);
        }}
      >
        <SheetContent
          className="w-full gap-4 md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
          finalFocus={() => (jumped.current ? false : trigger.current)}
        >
          {open && outcome ? (
            <TimingReviewBody
              {...props}
              outcome={outcome}
              onClose={() => setOpen(false)}
              onOpenStop={(id) => {
                jumped.current = id;
                setOpen(false);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
