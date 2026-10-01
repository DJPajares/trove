/** Versioned derived assessments. Weights and raw provider evidence stay internal. */
export type PlanScoreDayFactorId =
  'FEASIBILITY' | 'ROUTE_EFFICIENCY' | 'PACE_COMFORT' | 'EXPERIENCE_QUALITY' | 'PLAN_COMPOSITION';
export type PlanScoreTripComponentId =
  'DAILY_QUALITY' | 'DESTINATION_UTILIZATION' | 'VARIETY_COVERAGE' | 'SEASONAL_FIT';
export type PlanScoreUnknownReason =
  'INSUFFICIENT_EVIDENCE' | 'MISSING_EVIDENCE' | 'UNUSABLE_EVIDENCE';
export type PlanScoreAssessmentStatus = 'available' | 'provisional' | 'unavailable';
export type PlanScoreAssessmentBasis = 'TIMING' | 'ACTIVITY_LOAD' | 'VERIFIED_PROBLEM' | 'REST';
export type PlanScoreLimitation =
  | 'TRAVEL_TIME_UNKNOWN'
  /** Every unrouted leg was estimated from straight-line distance. */
  | 'TRAVEL_TIME_ESTIMATED'
  /** Some visit lengths come from the planned times or typical lengths, not the plan itself. */
  | 'DURATION_ESTIMATED'
  | 'LOAD_INCOMPLETE'
  | 'TIMING_UNKNOWN'
  | 'VENUE_EVIDENCE_INCOMPLETE'
  | 'UNASSESSED_DAYS'
  /** Some stops have no location, time or duration yet; they count low until they do. */
  | 'DETAIL_MISSING';
export type PlanScoreFactorOutcome =
  | { confidence: number; coverage: number; score: number; state: 'EVALUATED' }
  | { confidence: number; coverage: number; state: 'LIMITED' }
  | { reason: PlanScoreUnknownReason; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };
export type PlanScoreDayWithheldReason =
  'EVIDENCE_NOT_CURRENT' | 'ADMINISTRATIVELY_DISABLED' | 'NO_MEANINGFUL_EVIDENCE';
export type PlanScoreTripWithheldReason =
  'ADMINISTRATIVELY_DISABLED' | 'NO_SCORABLE_DAY' | 'EVIDENCE_NOT_CURRENT';
export type PlanScoreCap = {
  limit: number;
  reason:
    | 'HARD_CONFLICT'
    | 'MULTIPLE_HARD_CONFLICTS'
    | 'MATERIAL_CONFLICT'
    | 'TRIP_HARD_CONFLICT'
    | 'TRIP_CONNECTION_CONFLICT';
  references: string[];
};
export type PlanScoreDayPayload = {
  assessmentStatus: PlanScoreAssessmentStatus;
  assessmentBasis: PlanScoreAssessmentBasis[];
  limitations: PlanScoreLimitation[];
  /** Applicable signal coverage, independent of assessed quality. */
  completeness: number;
  confidence: number | null;
  dayId: string;
  factors: Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>;
  score: number | null;
  caps: PlanScoreCap[];
  withheldReasons: PlanScoreDayWithheldReason[];
};
export type PlanScoreTripPayload = {
  assessmentStatus: PlanScoreAssessmentStatus;
  assessmentBasis: PlanScoreAssessmentBasis[];
  limitations: PlanScoreLimitation[];
  assessedDayCount: number;
  applicableDayCount: number;
  evidenceCoverage: number;
  days: PlanScoreDayPayload[];
  components: Record<PlanScoreTripComponentId, PlanScoreFactorOutcome>;
  completeness: number;
  confidence: number | null;
  caps: PlanScoreCap[];
  score: number | null;
  withheldReasons: PlanScoreTripWithheldReason[];
};
export type PlanScoreExplanationFactor = PlanScoreDayFactorId | PlanScoreTripComponentId;
export type PlanScoreSuggestedAction =
  | 'ADD_BUFFER'
  | 'ADJUST_TIME'
  | 'RECONSIDER_DETOUR'
  | 'REORDER_MANUALLY'
  | 'REVIEW_ALTERNATIVE'
  | 'SCHEDULE_MUST_GO'
  | 'REDUCE_LOAD'
  | 'REVIEW_TIMING'
  | 'LINK_PLACE'
  | 'EDIT_TRANSFER'
  | 'ADD_TIMING';
export type PlanScoreExplanation = {
  action: PlanScoreSuggestedAction | null;
  factor: PlanScoreExplanationFactor;
  code: string;
  severity: 'INFO' | 'RISK' | 'MATERIAL' | 'HARD';
  messageKey: string;
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
export type PlanScoreReferenceTarget =
  { kind: 'item'; dayId: string | null } | { kind: 'reservation' } | { kind: 'trip_place' };
export type TripPlanScore = Omit<PlanScoreTripPayload, 'days'> & {
  schemaVersion: 8;
  rubricVersion: 12;
  days: TripPlanScoreDay[];
  explanations: PlanScoreExplanationGroups;
  fingerprint: string;
  generatedAt: string;
  recomputeAfter: string;
  evidenceExpiresAt: string | null;
  evidenceRevision?: string;
  evidenceAsOf?: string | null;
  sourceInputRevision?: string;
  /** Derived presentation metadata; raw evidence is never included. */
  presentation?: {
    adjustments: { fatigue: number; weakDays: number };
    /** Opaque digests only. No planning inputs or provider evidence are exposed. */
    revisions: { planning: string; evidence: string; destinationContext: string };
    /** Only known, owned targets already referenced by an explanation. */
    referenceTargets?: Record<string, PlanScoreReferenceTarget>;
  };
};
