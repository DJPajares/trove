'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { TripOverviewData } from '@trove/types';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { TripHubScore } from '@/components/trip-hub-score';
import { TripInsights } from '@/components/trip-insights';
import { queryKeys } from '@/lib/query/keys';
import { updateTask } from '@/lib/tasks/api';
import type { Trip } from '@/lib/trips/api';
import type { TripHubStage } from '@/lib/trips/overview';

const sectionTitle =
  'text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em]';
const kicker = 'text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase';

/**
 * Plan Score and the one insight worth knowing. While travelling the day's
 * insight already sits in the chapter, so only the score stays here; once the
 * trip is over, neither is the point any more.
 */
export function TripHubGoodToKnow({
  planScoreEnabled,
  stage,
  trip,
}: Readonly<{ planScoreEnabled: boolean; stage: TripHubStage; trip: Trip }>) {
  const t = useTranslations('trips.hub');
  if (stage === 'remember' || (!planScoreEnabled && stage === 'live')) return null;
  return (
    <section aria-labelledby="trip-good-to-know-heading" className="space-y-3">
      <h2 className={sectionTitle} id="trip-good-to-know-heading">
        {t('goodToKnow')}
      </h2>
      {planScoreEnabled ? <TripHubScore tripId={trip.id} /> : null}
      {stage === 'live' ? null : (
        <TripInsights headingLevel={3} initialItemLimit={1} tripId={trip.id} />
      )}
    </section>
  );
}

/**
 * The next thing to do and the facts pinned to keep near. A task is ticked off
 * where it stands; anything more opens Tasks or Trip info.
 */
export function TripHubCloseAtHand({
  overview,
  stage,
  trip,
}: Readonly<{ overview: TripOverviewData | undefined; stage: TripHubStage; trip: Trip }>) {
  const t = useTranslations('trips');
  const hub = useTranslations('trips.hub');
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const next = overview?.tasks.next ?? null;
  const pinned = overview?.pinnedInfo ?? [];
  if (stage === 'remember' || (!next && !pinned.length)) return null;

  async function complete(taskId: string) {
    setCompleting(taskId);
    setFailed(false);
    try {
      await updateTask(trip.id, taskId, { completed: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trip-overview', trip.id] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(trip.id) }),
      ]);
    } catch {
      setFailed(true);
    } finally {
      setCompleting(null);
    }
  }

  const more = next && overview ? overview.tasks.openCount - 1 : 0;

  return (
    <section aria-labelledby="trip-close-at-hand-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={sectionTitle} id="trip-close-at-hand-heading">
          {hub('closeAtHand')}
        </h2>
        <Link
          className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] text-sm font-semibold text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
          href={`/trips/${trip.id}/${next ? 'tasks' : 'info'}`}
        >
          {next ? hub('allTasks') : t('viewTripInfo')}
        </Link>
      </div>

      {next ? (
        <div>
          <p className={kicker}>{hub(stage === 'live' ? 'todayTask' : 'nextStep')}</p>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 py-3.5 transition-colors duration-[var(--motion-standard)] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 hover:bg-surface-hover motion-reduce:transition-none">
            <input
              className="mt-0.5 size-5 shrink-0 accent-primary"
              disabled={completing === next.id}
              onChange={() => void complete(next.id)}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block leading-snug font-semibold break-words">{next.label}</span>
              {more > 0 ? (
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {hub('moreTasks', { count: more })}
                </span>
              ) : null}
            </span>
          </label>
          {failed ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {hub('taskError')}
            </p>
          ) : null}
        </div>
      ) : null}

      {pinned.length ? (
        <div>
          <p className={kicker}>{hub('pinned')}</p>
          <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5">
            {pinned.map((entry) => (
              <div
                className="rounded-[var(--radius-xl)] border border-border-subtle bg-card p-3.5"
                key={entry.id}
              >
                <dt className="text-[0.6875rem] font-semibold tracking-[0.1em] text-accent-strong uppercase">
                  {entry.label}
                </dt>
                <dd className="mt-1.5 text-[0.9375rem] leading-snug font-semibold break-words">
                  {entry.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
