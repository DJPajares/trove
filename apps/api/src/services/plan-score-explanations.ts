import type {
  PlanScoreAlternative,
  PlanScoreAlternativeAction,
  PlanScoreConflict,
  PlanScoreConflictKind,
  PlanScoreConflictSeverity,
  PlanScorePaceEvaluation,
  PlanScoreRouteEfficiencyEvaluation,
  PlanScoreTravelEffortEvaluation,
} from './plan-score-factors.js';
import type {
  PlanScoreDayFactorId,
  PlanScoreDayResult,
  PlanScoreEvidence,
  PlanScoreFactorOutcome,
} from './plan-score-rules.js';

/**
 * Deterministic Plan Score explanations (PRD section 29.4).
 *
 * Explanations are structured objects carrying localization keys and values, so
 * no user-facing prose lives here and no model call is needed to produce them.
 * Values describe the plan in the traveller's own terms: minutes, counts, and
 * public ratings, never base weights or factor math.
 *
 * Suggestions are inert. `planReplacement` describes what a confirmed Replace
 * would carry over and what the traveller must review; nothing is applied here.
 */

export type PlanScoreExplanationFactor = PlanScoreDayFactorId | 'MUST_GO_PRIORITY_FIT';

/** Existing edit flows the UI can route to. Trove never applies these itself. */
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

export type PlanScoreDayExplanationInput = {
  /** Recommendations only; they never change the itinerary. */
  alternatives: PlanScoreAlternative[];
  conflicts: PlanScoreConflict[];
  day: PlanScoreDayResult;
  pace: Pick<PlanScorePaceEvaluation, 'activeMinutes' | 'smallestBufferMinutes'>;
  route: Pick<PlanScoreRouteEfficiencyEvaluation, 'bestMinutes' | 'plannedMinutes'>;
  travel: Pick<PlanScoreTravelEffortEvaluation, 'totalMinutes'>;
};

export type PlanScoreTripExplanationInput = {
  mustGoPriorityFit: PlanScoreFactorOutcome;
  /** Must Go Trip Places not scheduled anywhere in the itinerary. */
  unscheduledMustGoTripPlaceIds: string[];
};

type ExplanationGroup = keyof PlanScoreExplanationGroups;

type Entry = PlanScoreExplanation & { group: ExplanationGroup };

const FACTOR_MESSAGE_ROOTS: Record<PlanScoreExplanationFactor, string> = {
  FEASIBILITY: 'feasibility',
  MUST_GO_PRIORITY_FIT: 'mustGo',
  PACE_BUFFER: 'pace',
  PLACE_QUALITY: 'placeQuality',
  ROUTE_EFFICIENCY: 'routeEfficiency',
  TRAVEL_EFFORT: 'travelEffort',
};

const CONFLICT_MESSAGES: Record<
  PlanScoreConflictKind,
  { action: PlanScoreSuggestedAction; messageKey: string }
> = {
  ARRIVES_AFTER_FIXED_START: {
    action: 'ADJUST_TIME',
    messageKey: 'feasibility.arrivesAfterFixedStart',
  },
  OUTSIDE_OPENING_HOURS: { action: 'ADJUST_TIME', messageKey: 'feasibility.outsideOpeningHours' },
  OVERLAPPING_COMMITMENTS: {
    action: 'ADJUST_TIME',
    messageKey: 'feasibility.overlappingCommitments',
  },
  TIGHT_TRANSITION: { action: 'ADD_BUFFER', messageKey: 'feasibility.tightTransition' },
};

const ALTERNATIVE_MESSAGES: Record<PlanScoreAlternativeAction, string> = {
  ADD: 'alternative.add',
  REPLACE: 'alternative.replace',
};

const SEVERITY_ORDER: Record<PlanScoreConflictSeverity, number> = { HARD: 0, MATERIAL: 1, SOFT: 2 };

/** A factor at or above this reads as working; at or below the weak mark it deserves attention. */
const STRONG_FACTOR_SCORE = 85;
const WEAK_FACTOR_SCORE = 60;

/** Item fields a confirmed Replace carries over unchanged (PRD section 29.4). */
export const PLAN_SCORE_PRESERVED_ITEM_FIELDS: readonly string[] = [
  'dayPart',
  'durationMinutes',
  'notes',
  'priority',
  'startDate',
  'startTime',
];

function uncertaintyEntries(
  factor: PlanScoreExplanationFactor,
  outcome: PlanScoreFactorOutcome,
  evidence: PlanScoreEvidence[],
): Entry[] {
  const root = FACTOR_MESSAGE_ROOTS[factor];

  if (outcome.state === 'NOT_APPLICABLE') return [];
  if (outcome.state === 'UNKNOWN') {
    return [
      {
        action: null,
        factor,
        group: 'uncertainty',
        messageKey: `${root}.unknown`,
        references: [],
        values: {},
      },
    ];
  }

  const stale = evidence.filter((entry) => entry.source === 'STALE');
  if (stale.length === 0) return [];

  return [
    {
      action: null,
      factor,
      group: 'uncertainty',
      messageKey: `${root}.stale`,
      references: stale.map((entry) => entry.ref),
      values: { count: stale.length },
    },
  ];
}

function feasibilityEntries(input: PlanScoreDayExplanationInput): Entry[] {
  const outcome = input.day.factors.FEASIBILITY;
  const entries = uncertaintyEntries('FEASIBILITY', outcome, input.day.evidence.FEASIBILITY);
  if (outcome.state !== 'EVALUATED') return entries;

  const ranked = input.conflicts.toSorted(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity],
  );

  if (ranked.length === 0) {
    return [
      {
        action: null,
        factor: 'FEASIBILITY',
        group: 'whatWorks',
        messageKey: 'feasibility.noConflicts',
        references: [],
        values: {},
      },
      ...entries,
    ];
  }

  return [
    ...ranked.map((conflict): Entry => {
      const message = CONFLICT_MESSAGES[conflict.kind];
      return {
        action: message.action,
        factor: 'FEASIBILITY',
        group: 'worthImproving',
        messageKey: message.messageKey,
        references: conflict.subjectIds,
        values: { severity: conflict.severity },
      };
    }),
    ...entries,
  ];
}

function bandedEntries(
  factor: PlanScoreExplanationFactor,
  outcome: PlanScoreFactorOutcome,
  evidence: PlanScoreEvidence[],
  strong: { messageKey: string; values: Record<string, number | string> },
  /** `null` when a low score is a preference signal rather than something to fix. */
  weak: {
    action: PlanScoreSuggestedAction;
    messageKey: string;
    values: Record<string, number | string>;
  } | null,
): Entry[] {
  const entries = uncertaintyEntries(factor, outcome, evidence);
  if (outcome.state !== 'EVALUATED') return entries;

  if (outcome.score >= STRONG_FACTOR_SCORE) {
    return [
      {
        action: null,
        factor,
        group: 'whatWorks',
        messageKey: strong.messageKey,
        references: [],
        values: strong.values,
      },
      ...entries,
    ];
  }

  if (weak && outcome.score <= WEAK_FACTOR_SCORE) {
    return [
      {
        action: weak.action,
        factor,
        group: 'worthImproving',
        messageKey: weak.messageKey,
        references: [],
        values: weak.values,
      },
      ...entries,
    ];
  }

  return entries;
}

function knownValues(values: Record<string, number | null>) {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => (value === null ? [] : [[key, value]])),
  );
}

function alternativeEntries(alternatives: PlanScoreAlternative[]): Entry[] {
  return alternatives
    .toSorted(
      (left, right) =>
        right.improvement - left.improvement || left.targetItemId.localeCompare(right.targetItemId),
    )
    .map((alternative) => ({
      action: 'REVIEW_ALTERNATIVE' as const,
      factor: 'PLACE_QUALITY' as const,
      group: 'worthImproving' as const,
      messageKey: ALTERNATIVE_MESSAGES[alternative.action],
      references: [alternative.targetItemId, alternative.candidateTripPlaceId],
      values: {
        candidateRating: alternative.candidateRating,
        currentRating: alternative.currentRating,
      },
    }));
}

function group(entries: Entry[]): PlanScoreExplanationGroups {
  const groups: PlanScoreExplanationGroups = { uncertainty: [], whatWorks: [], worthImproving: [] };

  for (const entry of entries) {
    const { group: name, ...explanation } = entry;
    groups[name].push(explanation);
  }

  return groups;
}

/**
 * Orders explanations by consequence: feasibility, travel effort, pace, route
 * efficiency, then supporting place quality and provider-backed alternatives.
 * Place quality only ever reports what works; a low public rating is a
 * preference signal, so improvement is offered through alternatives instead.
 */
export function explainDay(input: PlanScoreDayExplanationInput): PlanScoreExplanationGroups {
  return group([
    ...feasibilityEntries(input),
    ...bandedEntries(
      'TRAVEL_EFFORT',
      input.day.factors.TRAVEL_EFFORT,
      input.day.evidence.TRAVEL_EFFORT,
      {
        messageKey: 'travelEffort.light',
        values: knownValues({ minutes: input.travel.totalMinutes }),
      },
      {
        action: 'RECONSIDER_DETOUR',
        messageKey: 'travelEffort.heavy',
        values: knownValues({ minutes: input.travel.totalMinutes }),
      },
    ),
    ...bandedEntries(
      'PACE_BUFFER',
      input.day.factors.PACE_BUFFER,
      input.day.evidence.PACE_BUFFER,
      { messageKey: 'pace.comfortable', values: {} },
      {
        action: 'ADD_BUFFER',
        messageKey: 'pace.tight',
        values: knownValues({
          activeMinutes: input.pace.activeMinutes,
          bufferMinutes: input.pace.smallestBufferMinutes,
        }),
      },
    ),
    ...bandedEntries(
      'ROUTE_EFFICIENCY',
      input.day.factors.ROUTE_EFFICIENCY,
      input.day.evidence.ROUTE_EFFICIENCY,
      { messageKey: 'routeEfficiency.direct', values: {} },
      {
        action: 'REORDER_MANUALLY',
        messageKey: 'routeEfficiency.backtracking',
        values: knownValues({
          bestMinutes: input.route.bestMinutes,
          plannedMinutes: input.route.plannedMinutes,
        }),
      },
    ),
    ...bandedEntries(
      'PLACE_QUALITY',
      input.day.factors.PLACE_QUALITY,
      input.day.evidence.PLACE_QUALITY,
      { messageKey: 'placeQuality.strong', values: {} },
      null,
    ),
    ...alternativeEntries(input.alternatives),
  ]);
}

/** Trip-scoped explanation for Must Go priority fit. */
export function explainTrip(input: PlanScoreTripExplanationInput): PlanScoreExplanationGroups {
  const outcome = input.mustGoPriorityFit;
  const entries = uncertaintyEntries('MUST_GO_PRIORITY_FIT', outcome, []);
  if (outcome.state !== 'EVALUATED') return group(entries);

  const unscheduled = input.unscheduledMustGoTripPlaceIds;
  if (unscheduled.length === 0) {
    return group([
      {
        action: null,
        factor: 'MUST_GO_PRIORITY_FIT',
        group: 'whatWorks',
        messageKey: 'mustGo.allScheduled',
        references: [],
        values: {},
      },
      ...entries,
    ]);
  }

  return group([
    {
      action: 'SCHEDULE_MUST_GO',
      factor: 'MUST_GO_PRIORITY_FIT',
      group: 'worthImproving',
      messageKey: 'mustGo.unscheduled',
      references: unscheduled,
      values: { count: unscheduled.length },
    },
    ...entries,
  ]);
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
