'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SuggestedAction } from '@/components/plan-score-panel';
import type { PlanScoreExplanation } from '@/lib/plan-score/api';
import type { ScoreAction } from '@/lib/plan-score/presentation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

/**
 * A quiet line that something here is worth a look, set where it happens. It
 * is never an alarm: the plan is the traveller's, and the note only says what
 * Trove can see and, when it can help, the one thing to do about it.
 */
export function AttentionNote({
  action,
  children,
  className,
}: Readonly<{ action?: ReactNode; children: ReactNode; className?: string }>) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-[var(--radius-md)] bg-status-warning/8 px-2.5 py-2 text-sm leading-snug text-foreground',
        className,
      )}
      data-slot="attention-note"
    >
      <Icons.Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
      <div className="min-w-0 space-y-0.5">
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

/** A Plan Score problem, worded and actioned exactly as the day's score card words it. */
export function ScoreProblemNote({
  className,
  problem,
  resolveAction,
}: Readonly<{
  className?: string;
  problem: PlanScoreExplanation;
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
}>) {
  const t = useTranslations('planScore');

  return (
    <AttentionNote
      action={<SuggestedAction explanation={problem} resolveAction={resolveAction} />}
      className={className}
    >
      {t(problem.messageKey, problem.values)}
    </AttentionNote>
  );
}
