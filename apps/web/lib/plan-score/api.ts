import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import type { TripPlanScore } from '@trove/types';
import { observeServerTime } from './clock';

export type {
  PlanScoreDayFactorId as PlanScoreFactorId,
  PlanScoreFactorOutcome,
  PlanScoreSuggestedAction,
  PlanScoreExplanation,
  PlanScoreExplanationGroups,
  TripPlanScoreDay as PlanScoreDay,
  TripPlanScore,
} from '@trove/types';

export class PlanScoreApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

/**
 * Plan Score is derived from live route and provider evidence, so it is never
 * read from the offline snapshot; callers degrade to their unavailable state.
 */
export async function fetchTripPlanScore(tripId: string, signal?: AbortSignal) {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new PlanScoreApiError('supabase_not_configured', 500);

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new PlanScoreApiError('not_authenticated', 401);

  const response = await fetch(`${apiUrl}/trips/${tripId}/plan-score`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    signal,
  });

  observeServerTime(response);
  if (response.status === 204) return null;

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new PlanScoreApiError(
      body.code ?? `plan_score_request_failed_${response.status}`,
      response.status,
    );
  }

  const score = (await response.json()) as TripPlanScore;
  if (score.schemaVersion !== 8 || score.rubricVersion !== 12)
    throw new PlanScoreApiError('incompatible_assessment', 409);
  return score;
}
