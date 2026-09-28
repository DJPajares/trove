/**
 * Shared wire contract for the currently deployed Plan Score evaluator.
 *
 * PRD section 29 defines the approved redesign. Migrate these types alongside
 * its evaluator and consumers; changing the category names here alone would
 * misrepresent cached assessments produced by the existing rubric.
 * Scoring weights and raw provider evidence never belong in this payload.
 */
export type PlanScoreDayFactorId =
  'FEASIBILITY' | 'PACE_BUFFER' | 'PLACE_QUALITY' | 'ROUTE_EFFICIENCY' | 'TRAVEL_EFFORT';

export type PlanScoreUnknownReason =
  'INSUFFICIENT_EVIDENCE' | 'MISSING_EVIDENCE' | 'UNUSABLE_EVIDENCE';

export type PlanScoreFactorOutcome =
  | { confidence: number; score: number; state: 'EVALUATED' }
  | { reason: PlanScoreUnknownReason; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };

export type PlanScoreDayWithheldReason =
  | 'EVIDENCE_NOT_CURRENT'
  | 'ADMINISTRATIVELY_DISABLED'
  | 'INSUFFICIENT_COMPLETENESS'
  | 'NO_EVALUABLE_CORE_FACTOR';

export type PlanScoreTripWithheldReason =
  'ADMINISTRATIVELY_DISABLED' | 'NO_SCORABLE_DAY' | 'EVIDENCE_NOT_CURRENT';

export type PlanScoreDayPayload = {
  completeness: number;
  confidence: number | null;
  dayId: string;
  factors: Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>;
  /** Missing evidence withholds a score; it is never reported as poor quality. */
  score: number | null;
  withheldReasons: PlanScoreDayWithheldReason[];
};

export type PlanScoreTripPayload = {
  days: PlanScoreDayPayload[];
  mustGoPriorityFit: PlanScoreFactorOutcome;
  score: number | null;
  withheldReasons: PlanScoreTripWithheldReason[];
};

export type PlanScoreExplanationFactor = PlanScoreDayFactorId | 'MUST_GO_PRIORITY_FIT';

/** Existing edit flows the UI can route to; suggestions never apply themselves. */
export type PlanScoreSuggestedAction =
  | 'ADD_BUFFER'
  | 'ADJUST_TIME'
  | 'RECONSIDER_DETOUR'
  | 'REORDER_MANUALLY'
  | 'REVIEW_ALTERNATIVE'
  | 'SCHEDULE_MUST_GO';

export type PlanScoreExplanation = {
  action: PlanScoreSuggestedAction | null;
  factor: PlanScoreExplanationFactor;
  /** Localization key under the `planScore` namespace. */
  messageKey: string;
  /** Itinerary items, Trip Places, or evidence points the message refers to. */
  references: string[];
  values: Record<string, number | string>;
};

export type PlanScoreExplanationGroups = {
  uncertainty: PlanScoreExplanation[];
  whatWorks: PlanScoreExplanation[];
  worthImproving: PlanScoreExplanation[];
};

export type TripPlanScoreDay = PlanScoreDayPayload & {
  date: string;
  explanations: PlanScoreExplanationGroups;
};

export type TripPlanScore = Omit<PlanScoreTripPayload, 'days'> & {
  days: TripPlanScoreDay[];
  explanations: PlanScoreExplanationGroups;
  /** Identity of the evidence this result came from, for cache validation. */
  fingerprint: string;
  generatedAt: string;
  /** Assessment deadline, bounded by generation and the original evidence expiry. */
  expiresAt?: string;
  /** Revision of read-only evidence used by stored-trip assessments. */
  evidenceRevision?: string;
  /** Original oldest mutable evidence time, never its cache-read or Apply time. */
  evidenceAsOf?: string | null;
  /** Rubric-versioned draft inputs, checked before adopting an AI assessment. */
  sourceInputRevision?: string;
};
