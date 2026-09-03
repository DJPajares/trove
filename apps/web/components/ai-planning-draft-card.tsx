'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cancelAiPlanningSession, recoverAiPlanningSession } from '@/lib/ai-planning/api';
import { queryKeys } from '@/lib/query/keys';
import { formatTripDateRange } from '@/lib/trips/format';

/**
 * The way back into a draft the traveller walked away from.
 *
 * A reviewing session is a trip in waiting, so it waits where trips are: the
 * review screen is no longer something the app navigates you into behind your
 * back, which means the only thing keeping a draft reachable is this card.
 *
 * It reads the recovery query rather than `useAiPlanningLifecycle`, whose state
 * machine belongs to the creation sheet. The key is shared, so this costs no
 * request of its own.
 */
export function AiPlanningDraftCard() {
  const t = useTranslations('trips.aiPlanning.draftCard');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { data } = useQuery({
    queryFn: recoverAiPlanningSession,
    queryKey: queryKeys.aiPlanningRecovery(),
  });

  const session = data?.session ?? null;
  const draft = session?.status === 'reviewing' ? session.draft : null;
  const planScore = session?.planScore?.score ?? null;

  async function discard() {
    if (!session || discarding) return;
    setDiscarding(true);
    try {
      await cancelAiPlanningSession(session.id);
      queryClient.removeQueries({ queryKey: queryKeys.aiPlanningSession(session.id) });
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
      setConfirmDiscard(false);
    } finally {
      setDiscarding(false);
    }
  }

  // A generating session gets no card: the takeover already owns that state and
  // saying it twice on the same screen would be two answers to one question.
  if (!session || !draft) return null;

  return (
    <section
      aria-labelledby="ai-planning-draft-heading"
      className="rounded-[var(--radius-xl)] border border-border-strong bg-card p-4 shadow-[var(--shadow-card)] sm:p-5"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
        <Sparkles aria-hidden="true" className="size-3.5" />
        {t('eyebrow')}
      </p>
      <h2
        className="mt-2 text-[length:var(--text-section-title)] font-semibold tracking-[-0.02em]"
        id="ai-planning-draft-heading"
      >
        {draft.trip.name}
      </h2>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
        {formatTripDateRange(draft.trip.startDate, draft.trip.endDate, locale)}
        {planScore === null ? null : ` · ${t('planScore', { score: planScore })}`}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">{t('description')}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {/* Going back to a draft is navigation, not an action. */}
        <Button nativeButton={false} render={<Link href={`/trips/ai/${session.id}`} />}>
          {t('continue')}
        </Button>
        <Button onClick={() => setConfirmDiscard(true)} type="button" variant="ghost">
          {t('discard')}
        </Button>
      </div>

      <Dialog onOpenChange={setConfirmDiscard} open={confirmDiscard}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t('discardTitle')}</DialogTitle>
            <DialogDescription>{t('discardDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={discarding}
              onClick={() => setConfirmDiscard(false)}
              type="button"
              variant="ghost"
            >
              {t('keep')}
            </Button>
            <Button
              disabled={discarding}
              onClick={() => void discard()}
              type="button"
              variant="destructive"
            >
              {discarding ? t('discarding') : t('discardConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
