import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type PlanScoreFactorId =
  'FEASIBILITY' | 'PACE_BUFFER' | 'PLACE_QUALITY' | 'ROUTE_EFFICIENCY' | 'TRAVEL_EFFORT';

export type PlanScoreFactorOutcome =
  | { confidence: number; score: number; state: 'EVALUATED' }
  | { reason: string; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };

export type PlanScoreSuggestedAction =
  | 'ADD_BUFFER'
  | 'ADJUST_TIME'
  | 'RECONSIDER_DETOUR'
  | 'REORDER_MANUALLY'
  | 'REVIEW_ALTERNATIVE'
  | 'SCHEDULE_MUST_GO';

export type PlanScoreExplanation = {
  action: PlanScoreSuggestedAction | null;
  factor: string;
  messageKey: string;
  references: string[];
  values: Record<string, number | string>;
};

export type PlanScoreExplanationGroups = {
  uncertainty: PlanScoreExplanation[];
  whatWorks: PlanScoreExplanation[];
  worthImproving: PlanScoreExplanation[];
};

export type PlanScoreDay = {
  completeness: number;
  confidence: number | null;
  date: string;
  dayId: string;
  explanations: PlanScoreExplanationGroups;
  factors: Record<PlanScoreFactorId, PlanScoreFactorOutcome>;
  score: number | null;
  withheldReasons: string[];
};

export type TripPlanScore = {
  days: PlanScoreDay[];
  explanations: PlanScoreExplanationGroups;
  fingerprint: string;
  generatedAt: string;
  mustGoPriorityFit: PlanScoreFactorOutcome;
  score: number | null;
  withheldReasons: string[];
};

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

  if (response.status === 204) return null;

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new PlanScoreApiError(
      body.code ?? `plan_score_request_failed_${response.status}`,
      response.status,
    );
  }

  return response.json() as Promise<TripPlanScore>;
}
