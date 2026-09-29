import type {
  PlanScoreExplanation,
  PlanScoreExplanationFactor,
  PlanScoreExplanationGroups,
  PlanScoreFactorOutcome,
  PlanScoreCap,
} from '@trove/types';
export type {
  PlanScoreExplanation,
  PlanScoreExplanationFactor,
  PlanScoreExplanationGroups,
  PlanScoreSuggestedAction,
} from '@trove/types';
import type {
  PlanScoreAlternative,
  PlanScoreConflict,
  PlanScoreConflictKind,
} from './plan-score-factors.js';
import type { PlanScoreDayResult } from './plan-score-rules.js';
import { DAY_FACTOR_IDS } from './plan-score-rules.js';
import type { DayAdvisory } from './plan-score-evaluation.js';
export const PLAN_SCORE_PRESERVED_ITEM_FIELDS = [
  'dayPart',
  'durationMinutes',
  'notes',
  'priority',
  'startDate',
  'startTime',
] as const;
export type PlanScoreDayExplanationInput = {
  alternatives: PlanScoreAlternative[];
  conflicts: PlanScoreConflict[];
  day: PlanScoreDayResult;
  pace: {
    activeMinutes: number | null;
    smallestBufferMinutes: number | null;
    lowerBoundMinutes?: number | null;
  };
  route: { bestMinutes: number | null; plannedMinutes: number | null };
  travel: { totalMinutes: number | null };
  advisories?: DayAdvisory[];
};
export type PlanScoreTripExplanationInput = {
  components: Record<string, PlanScoreFactorOutcome>;
  caps: PlanScoreCap[];
  unscheduledMustGoTripPlaceIds: string[];
  fatigueAdjustment: number;
  weakDayAdjustment: number;
  fatigueDayIds?: string[];
  weakDayIds?: string[];
};
const roots: Record<PlanScoreExplanationFactor, string> = {
  FEASIBILITY: 'feasibility',
  ROUTE_EFFICIENCY: 'routeEfficiency',
  PACE_COMFORT: 'pace',
  EXPERIENCE_QUALITY: 'experienceQuality',
  PLAN_COMPOSITION: 'composition',
  DAILY_QUALITY: 'dailyQuality',
  DESTINATION_UTILIZATION: 'utilization',
  VARIETY_COVERAGE: 'variety',
  SEASONAL_FIT: 'seasonalFit',
};
const conflictMessages: Record<PlanScoreConflictKind, string> = {
  ARRIVES_AFTER_FIXED_START: 'feasibility.arrivesAfterFixedStart',
  OUTSIDE_OPENING_HOURS: 'feasibility.outsideOpeningHours',
  OVERLAPPING_COMMITMENTS: 'feasibility.overlappingCommitments',
  TIGHT_TRANSITION: 'feasibility.tightTransition',
  OUTSIDE_AVAILABILITY: 'feasibility.outsideAvailability',
};
function reason(
  factor: PlanScoreExplanationFactor,
  code: string,
  messageKey: string,
  options: Partial<Omit<PlanScoreExplanation, 'factor' | 'code' | 'messageKey'>> = {},
): PlanScoreExplanation {
  return {
    factor,
    code,
    messageKey,
    action: null,
    severity: 'INFO',
    references: [],
    values: {},
    ...options,
  };
}
export function explainDay(input: PlanScoreDayExplanationInput): PlanScoreExplanationGroups {
  const groups: PlanScoreExplanationGroups = { whatWorks: [], worthImproving: [], uncertainty: [] };
  const severityOrder = { HARD: 0, MATERIAL: 1, SOFT: 2 };
  for (const conflict of input.conflicts.toSorted(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id),
  )) {
    groups.worthImproving.push(
      reason('FEASIBILITY', conflict.kind, conflictMessages[conflict.kind], {
        action: conflict.kind === 'TIGHT_TRANSITION' ? 'ADD_BUFFER' : 'ADJUST_TIME',
        severity: conflict.severity === 'SOFT' ? 'RISK' : conflict.severity,
        references: conflict.subjectIds,
        values: { severity: conflict.verified ? conflict.severity : 'ESTIMATED' },
      }),
    );
  }
  for (const id of DAY_FACTOR_IDS) {
    const outcome = input.day.factors[id];
    if (outcome.state === 'NOT_APPLICABLE') continue;
    if (outcome.state === 'UNKNOWN') continue;
    if (id === 'FEASIBILITY') {
      if (!input.conflicts.length && outcome.state === 'EVALUATED')
        groups.whatWorks.push(reason(id, 'ASSESSED_TIMING_WORKS', 'feasibility.noConflicts'));
    } else if (id === 'ROUTE_EFFICIENCY') {
      if (
        outcome.state === 'EVALUATED' &&
        outcome.score >= 85 &&
        input.travel.totalMinutes !== null
      )
        groups.whatWorks.push(
          reason(id, 'LOCAL_TRAVEL_LIGHT', 'routeEfficiency.light', {
            values: { minutes: Math.round(input.travel.totalMinutes) },
          }),
        );
      if (input.travel.totalMinutes !== null && input.travel.totalMinutes > 180)
        groups.worthImproving.push(
          reason(id, 'LOCAL_TRAVEL_HEAVY', 'routeEfficiency.heavy', {
            action: 'RECONSIDER_DETOUR',
            severity: 'RISK',
            references: [input.day.dayId],
            values: { minutes: Math.round(input.travel.totalMinutes) },
          }),
        );
      if (
        input.route.bestMinutes !== null &&
        input.route.plannedMinutes !== null &&
        input.route.plannedMinutes > 1.1 * input.route.bestMinutes
      )
        groups.worthImproving.push(
          reason(id, 'AVOIDABLE_MOVEMENT', 'routeEfficiency.backtracking', {
            action: 'REORDER_MANUALLY',
            severity: 'RISK',
            references: [input.day.dayId],
            values: {
              bestMinutes: Math.round(input.route.bestMinutes),
              plannedMinutes: Math.round(input.route.plannedMinutes),
            },
          }),
        );
    } else if (id === 'PACE_COMFORT') {
      if (input.pace.lowerBoundMinutes != null)
        groups.worthImproving.push(
          reason(id, 'LOWER_BOUND_OVERLOAD', 'pace.lowerBoundLoad', {
            action: 'REDUCE_LOAD',
            severity: 'RISK',
            references: [input.day.dayId],
            values: { minutes: Math.round(input.pace.lowerBoundMinutes) },
          }),
        );
      if (input.day.incomingDebt > 0)
        groups.worthImproving.push(
          reason(id, 'INCOMING_FATIGUE', 'pace.accumulated', {
            action: 'REDUCE_LOAD',
            severity: 'RISK',
            references: [input.day.dayId],
          }),
        );
      if (outcome.state === 'EVALUATED' && outcome.score >= 85 && input.pace.activeMinutes !== null)
        groups.whatWorks.push(reason(id, 'COMFORTABLE_LOAD', 'pace.comfortable'));
      else if (
        outcome.state === 'EVALUATED' &&
        outcome.score <= 70 &&
        input.pace.activeMinutes !== null
      )
        groups.worthImproving.push(
          reason(id, 'HIGH_ACTIVE_LOAD', 'pace.load', {
            action: 'REDUCE_LOAD',
            severity: 'RISK',
            references: [input.day.dayId],
            values: { minutes: Math.round(input.pace.activeMinutes) },
          }),
        );
    } else if (id !== 'EXPERIENCE_QUALITY' && outcome.state === 'EVALUATED' && outcome.score >= 85)
      groups.whatWorks.push(reason(id, `${id}_SUPPORTED`, `${roots[id]}.supported`));
  }
  const advisoryMessages: Record<DayAdvisory['code'], string> = {
    NATURAL_DOWNTIME: 'pace.naturalDowntime',
    CONTINUOUS_ACTIVITY: 'pace.continuous',
    WALKING_LOAD: 'pace.walking',
    SEASONAL_PATTERN: 'timing.pattern',
    PUBLIC_HOLIDAY: 'timing.holiday',
    PARTIAL_ACCESS: 'timing.partialAccess',
    RAIN_FORECAST: 'timing.forecastRain',
    DAYLIGHT_LIMIT: 'timing.daylight',
  };
  const seen = new Set<string>();
  for (const advisory of input.advisories ?? []) {
    if (['SEASONAL_PATTERN', 'PUBLIC_HOLIDAY', 'PARTIAL_ACCESS'].includes(advisory.code)) continue;
    if (seen.has(advisory.code)) continue;
    seen.add(advisory.code);
    const positive = advisory.code === 'NATURAL_DOWNTIME';
    const comfort = ['NATURAL_DOWNTIME', 'CONTINUOUS_ACTIVITY', 'WALKING_LOAD'].includes(
      advisory.code,
    );
    const info = ['SEASONAL_PATTERN', 'PUBLIC_HOLIDAY'].includes(advisory.code);
    const entry = reason(
      comfort ? 'PACE_COMFORT' : 'EXPERIENCE_QUALITY',
      advisory.code,
      advisoryMessages[advisory.code],
      {
        severity: positive || info ? 'INFO' : 'RISK',
        action: positive || info ? null : 'REVIEW_TIMING',
        references: advisory.references,
      },
    );
    groups[positive ? 'whatWorks' : info ? 'uncertainty' : 'worthImproving'].push(entry);
  }
  return groups;
}
export function explainTrip(input: PlanScoreTripExplanationInput): PlanScoreExplanationGroups {
  const groups: PlanScoreExplanationGroups = { whatWorks: [], worthImproving: [], uncertainty: [] };
  for (const cap of input.caps)
    groups.worthImproving.push(
      reason('DAILY_QUALITY', cap.reason, 'trip.conflict', {
        action: 'ADJUST_TIME',
        severity: 'HARD',
        references: cap.references,
      }),
    );
  if (input.fatigueAdjustment > 0)
    groups.worthImproving.push(
      reason('DAILY_QUALITY', 'SUSTAINED_LOAD', 'trip.fatigue', {
        references: input.fatigueDayIds ?? [],
        action: 'REDUCE_LOAD',
        severity: 'RISK',
      }),
    );
  if (input.weakDayAdjustment > 0)
    groups.worthImproving.push(
      reason('DAILY_QUALITY', 'WEAK_DAYS', 'trip.weakDays', {
        references: input.weakDayIds ?? [],
        action: 'REVIEW_TIMING',
        severity: 'RISK',
      }),
    );
  if (input.unscheduledMustGoTripPlaceIds.length)
    groups.worthImproving.push(
      reason('DESTINATION_UTILIZATION', 'UNSCHEDULED_MUST_GO', 'mustGo.unscheduled', {
        action: 'SCHEDULE_MUST_GO',
        references: input.unscheduledMustGoTripPlaceIds,
        values: { count: input.unscheduledMustGoTripPlaceIds.length },
      }),
    );
  for (const [id, outcome] of Object.entries(input.components)) {
    const factor = id as PlanScoreExplanationFactor;
    if (outcome.state === 'EVALUATED' && outcome.score >= 85)
      groups.whatWorks.push(reason(factor, `${id}_SUPPORTED`, `${roots[factor]}.supported`));
  }
  return groups;
}

export type PlanScoreLinkedRecordKind = 'EXPENSE' | 'RESERVATION' | 'TASK';

export type PlanScoreLinkedRecord = { id: string; kind: PlanScoreLinkedRecordKind };

export type PlanScoreReplacementPlan = {
  candidateTripPlaceId: string;
  /** Item fields carried over unchanged when the traveller confirms. */
  preservedFields: readonly string[];
  /** Place-dependent records surfaced for review; nothing is discarded automatically. */
  requiresReview: PlanScoreLinkedRecord[];
  targetItemId: string;
};

/**
 * Describes what a confirmed Replace would do without doing it. Records linked to
 * the item's current Place are returned for review rather than dropped.
 */
export function planReplacement(input: {
  linkedRecords: PlanScoreLinkedRecord[];
  suggestion: PlanScoreAlternative;
}): PlanScoreReplacementPlan {
  if (input.suggestion.action !== 'REPLACE') throw new Error('unsupported_alternative_action');

  return {
    candidateTripPlaceId: input.suggestion.candidateTripPlaceId,
    preservedFields: PLAN_SCORE_PRESERVED_ITEM_FIELDS,
    requiresReview: input.linkedRecords.map((record) => ({ ...record })),
    targetItemId: input.suggestion.targetItemId,
  };
}
