'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cancelAiPlanningSession, recoverAiPlanningSession } from '@/lib/ai-planning/api';
import { queryKeys } from '@/lib/query/keys';
import { formatTripDateRange } from '@/lib/trips/format';
import * as Icons from '@/lib/icons';

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
export function AiPlanningDraftCard({
  headingLevel = 2,
}: Readonly<{
  /** Inside the library's Ahead section the draft is one of its entries. */
  headingLevel?: 2 | 3;
}> = {}) {
  const Heading = `h${headingLevel}` as const;
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

  // Dashed, like the open slot the Ahead calendar ends on: a trip in waiting,
  // drawn as one that has not been made yet.
  return (
    <section
      aria-labelledby="ai-planning-draft-heading"
      className="flex flex-col gap-4 rounded-[var(--radius-xl)] border border-dashed border-brand/50 bg-surface-tint/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5"
      data-slot="ai-planning-draft-card"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-brand uppercase">
          <Icons.Ai aria-hidden="true" className="size-3.5" />
          {t('eyebrow')}
        </p>
        <Heading
          className="mt-2 text-lg leading-[1.2] font-semibold tracking-[-0.02em] text-balance text-foreground"
          id="ai-planning-draft-heading"
        >
          {draft.trip.name}
        </Heading>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <CalendarDays aria-hidden="true" className="size-3.5 shrink-0" />
          {formatTripDateRange(draft.trip.startDate, draft.trip.endDate, locale)}
          {planScore === null ? null : ` · ${t('planScore', { score: planScore })}`}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {/* Going back to a draft is navigation, not an action. */}
        <Button nativeButton={false} render={<Link href={`/trips/ai/${session.id}`} />}>
          {t('continue')}
        </Button>
        <Button onClick={() => setConfirmDiscard(true)} type="button" variant="ghost">
          {t('discard')}
        </Button>
      </div>

      <AlertDialog onOpenChange={setConfirmDiscard} open={confirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>{t('keep')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={discarding}
              onClick={() => void discard()}
              variant="destructive"
            >
              {discarding ? t('discarding') : t('discardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
