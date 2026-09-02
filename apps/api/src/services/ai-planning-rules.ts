import {
  AI_PLANNER_MAX_DAYS,
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  parseAiPlannerDraft,
  parseAiPlannerModelProposal,
  type AiPlannerAssumption,
  type AiPlannerConstraint,
  type AiPlannerDraft,
  type AiPlannerDraftItem,
  type AiPlannerModelProposal,
  type AiPlannerNormalizedRequest,
} from '@trove/types';

import { enumerateDateRange, formatDateOnly, parseDateOnly } from './trip-rules.js';

export const AI_PLANNER_DEFAULT_PARTY_SIZE = 1;
export const AI_PLANNER_DEFAULT_PACE = 'balanced' as const;
/** Anchors trip length when the traveller names none, so the plan has a size. */
export const AI_PLANNER_DEFAULT_TRIP_LENGTH_DAYS = 5;

export type AiPlannerRuleIssueCode =
  | 'conflicting_hard_constraints'
  | 'dangling_reference'
  | 'duplicate_identifier'
  | 'hard_constraint_changed'
  | 'hard_constraint_missing'
  | 'hard_constraint_unscheduled'
  | 'invalid_contract'
  | 'invalid_date_range'
  | 'invalid_evidence'
  | 'invented_exact_time'
  | 'missing_assumption'
  | 'missing_duration_tier'
  | 'too_many_days'
  | 'too_many_real_place_items'
  | 'unsupported_schema_version';

export type AiPlannerRuleIssue = {
  code: AiPlannerRuleIssueCode;
  path: PropertyKey[];
  subjectId?: string;
};

export type AiPlannerValidationResult<OUTPUT> =
  { data: OUTPUT; success: true } | { issues: AiPlannerRuleIssue[]; success: false };

export class AiPlannerRulesError extends Error {
  constructor(public readonly code: AiPlannerRuleIssueCode) {
    super(code);
    this.name = 'AiPlannerRulesError';
  }
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseGenerationDate(value: Date | string) {
  return typeof value === 'string' ? parseDateOnly(value) : parseDateOnly(formatDateOnly(value));
}

function tripDates(startDate: string, endDate: string) {
  try {
    return enumerateDateRange(startDate, endDate);
  } catch {
    throw new AiPlannerRulesError('invalid_date_range');
  }
}

function plannerDate(value: string) {
  try {
    return parseDateOnly(value);
  } catch {
    throw new AiPlannerRulesError('invalid_date_range');
  }
}

export function resolveAiPlannerDateRange(
  request: AiPlannerNormalizedRequest,
  selectedDurationDays: 3 | 5 | 7 | null,
  generationDate: Date | string,
) {
  if (request.datePreference.kind === 'exact') {
    const dates = tripDates(request.datePreference.startDate, request.datePreference.endDate);
    if (dates.length > AI_PLANNER_MAX_DAYS) throw new AiPlannerRulesError('too_many_days');

    return {
      assumption: null,
      endDate: request.datePreference.endDate,
      source: 'user' as const,
      startDate: request.datePreference.startDate,
    };
  }

  if (!selectedDurationDays) throw new AiPlannerRulesError('missing_duration_tier');

  let minimumStart = addDays(parseGenerationDate(generationDate), 14);
  if (request.datePreference.kind === 'flexible' && request.datePreference.earliestStartDate) {
    const earliestStart = plannerDate(request.datePreference.earliestStartDate);
    if (earliestStart > minimumStart) minimumStart = earliestStart;
  }
  const daysUntilFriday = (5 - minimumStart.getUTCDay() + 7) % 7;
  const start = addDays(minimumStart, daysUntilFriday);
  const end = addDays(start, selectedDurationDays - 1);
  if (
    request.datePreference.kind === 'flexible' &&
    request.datePreference.latestEndDate &&
    end > plannerDate(request.datePreference.latestEndDate)
  ) {
    throw new AiPlannerRulesError('invalid_date_range');
  }
  const startDate = formatDateOnly(start);
  const endDate = formatDateOnly(end);

  return {
    assumption: {
      code: 'dates_defaulted',
      fieldPath: 'trip.dates',
      id: 'system:dates-defaulted',
      rationale: null,
      value: [startDate, endDate],
    } satisfies AiPlannerAssumption,
    endDate,
    source: 'default' as const,
    startDate,
  };
}

export function balancedPaceAnchorRange(dayIndex: number, totalDays: number) {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= totalDays || totalDays < 1) {
    throw new RangeError('invalid_day_index');
  }

  return dayIndex === 0 || dayIndex === totalDays - 1
    ? { maximum: 2, minimum: 0 }
    : { maximum: 3, minimum: 2 };
}

function assumptionById(assumptions: readonly AiPlannerAssumption[], id: string | null) {
  return id ? assumptions.find((assumption) => assumption.id === id) : undefined;
}

function requireProposalAssumption(
  proposal: AiPlannerModelProposal,
  assumptionId: string | null,
  code: AiPlannerAssumption['code'],
) {
  const assumption = assumptionById(proposal.assumptions, assumptionId);
  if (!assumption || assumption.code !== code) {
    throw new AiPlannerRulesError('missing_assumption');
  }
  return assumption.id;
}

export function resolveAiPlannerDefaults(
  request: AiPlannerNormalizedRequest,
  proposal: AiPlannerModelProposal,
  generationDate: Date | string,
) {
  const assumptions = [...proposal.assumptions];
  const dates = resolveAiPlannerDateRange(request, proposal.selectedDurationDays, generationDate);
  if (dates.assumption && !assumptionById(assumptions, dates.assumption.id)) {
    assumptions.push(dates.assumption);
  }

  const partySize = request.partySize ?? AI_PLANNER_DEFAULT_PARTY_SIZE;
  let partySizeAssumptionId: string | null = null;
  if (request.partySize === null) {
    partySizeAssumptionId = 'system:party-size-defaulted';
    if (!assumptionById(assumptions, partySizeAssumptionId)) {
      assumptions.push({
        code: 'party_size_defaulted',
        fieldPath: 'trip.partySize',
        id: partySizeAssumptionId,
        rationale: null,
        value: partySize,
      });
    }
  }

  const pace = request.pace ?? AI_PLANNER_DEFAULT_PACE;
  let paceAssumptionId: string | null = null;
  if (request.pace === null) {
    paceAssumptionId = 'system:pace-defaulted';
    if (!assumptionById(assumptions, paceAssumptionId)) {
      assumptions.push({
        code: 'pace_defaulted',
        fieldPath: 'trip.pace',
        id: paceAssumptionId,
        rationale: null,
        value: pace,
      });
    }
  }

  const nameSource = request.tripName === null ? ('model' as const) : ('user' as const);
  const nameAssumptionId =
    nameSource === 'model'
      ? requireProposalAssumption(
          proposal,
          proposal.assumptions.find((assumption) => assumption.code === 'trip_name_inferred')?.id ??
            null,
          'trip_name_inferred',
        )
      : null;

  proposal.destinations.forEach((destination) => {
    if (destination.source === 'model') {
      requireProposalAssumption(proposal, destination.assumptionId, 'destination_inferred');
    }
  });

  return {
    assumptions,
    dateAssumptionId: dates.assumption?.id ?? null,
    dateSource: dates.source,
    endDate: dates.endDate,
    name: request.tripName ?? proposal.tripName,
    nameAssumptionId,
    nameSource,
    pace,
    paceAssumptionId,
    paceSource: request.pace === null ? ('default' as const) : ('user' as const),
    partySize,
    partySizeAssumptionId,
    partySizeSource: request.partySize === null ? ('default' as const) : ('user' as const),
    startDate: dates.startDate,
  };
}

function duplicateIssues(
  values: readonly { id: string }[],
  path: PropertyKey[],
): AiPlannerRuleIssue[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    if (!seen.has(value.id)) {
      seen.add(value.id);
      return [];
    }
    return [
      { code: 'duplicate_identifier' as const, path: [...path, index, 'id'], subjectId: value.id },
    ];
  });
}

function constraintBlockType(kind: AiPlannerConstraint['kind']) {
  return kind === 'must_go' ? 'activity' : kind;
}

function minuteOfDay(localTime: string) {
  const [hour = '0', minute = '0'] = localTime.split(':');
  return Number(hour) * 60 + Number(minute);
}

function hasUserTimeConstraint(
  item: Pick<AiPlannerDraftItem, 'constraintIds' | 'schedule'>,
  constraints: ReadonlyMap<string, AiPlannerConstraint>,
) {
  if (item.schedule.kind !== 'exact') return true;
  const localTime = item.schedule.localTime;
  return item.constraintIds.some((constraintId) => {
    const constraint = constraints.get(constraintId);
    return constraint?.source === 'user' && constraint.localTime === localTime;
  });
}

function hasUserDurationConstraint(
  item: Pick<AiPlannerDraftItem, 'constraintIds' | 'durationMinutes' | 'durationProvenance'>,
  constraints: ReadonlyMap<string, AiPlannerConstraint>,
) {
  if (item.durationProvenance !== 'user_owned') return true;
  return item.constraintIds.some((constraintId) => {
    const constraint = constraints.get(constraintId);
    return constraint?.source === 'user' && constraint.durationMinutes === item.durationMinutes;
  });
}

function hasUserMustGoConstraint(
  item: Pick<AiPlannerDraftItem, 'constraintIds' | 'priority'>,
  constraints: ReadonlyMap<string, AiPlannerConstraint>,
) {
  if (item.priority !== 'must_go') return true;
  return item.constraintIds.some((constraintId) => {
    const constraint = constraints.get(constraintId);
    return constraint?.source === 'user' && constraint.kind === 'must_go';
  });
}

function modelProposalRuleIssues(proposal: AiPlannerModelProposal) {
  const issues: AiPlannerRuleIssue[] = [];
  const request = proposal.normalizedRequest;
  const candidates = new Set(proposal.places.map((place) => place.id));
  const destinationIntents = new Set(request.destinations.map((destination) => destination.id));
  const constraints = new Map(request.constraints.map((constraint) => [constraint.id, constraint]));

  issues.push(...duplicateIssues(proposal.places, ['places']));
  issues.push(...duplicateIssues(proposal.items, ['items']));
  issues.push(...duplicateIssues(proposal.assumptions, ['assumptions']));
  issues.push(...duplicateIssues(request.constraints, ['normalizedRequest', 'constraints']));
  issues.push(...duplicateIssues(request.destinations, ['normalizedRequest', 'destinations']));

  if (request.datePreference.kind === 'exact' && proposal.selectedDurationDays !== null) {
    issues.push({ code: 'invalid_contract', path: ['selectedDurationDays'] });
  }
  if (request.datePreference.kind !== 'exact' && proposal.selectedDurationDays === null) {
    issues.push({ code: 'missing_duration_tier', path: ['selectedDurationDays'] });
  }

  proposal.destinations.forEach((destination, index) => {
    if (!candidates.has(destination.candidatePlaceId)) {
      issues.push({
        code: 'dangling_reference',
        path: ['destinations', index, 'candidatePlaceId'],
        subjectId: destination.candidatePlaceId,
      });
    }
    if (destination.source === 'user') {
      if (
        !destination.destinationIntentId ||
        !destinationIntents.has(destination.destinationIntentId)
      ) {
        issues.push({
          code: 'dangling_reference',
          path: ['destinations', index, 'destinationIntentId'],
          subjectId: destination.destinationIntentId ?? undefined,
        });
      }
      if (destination.assumptionId !== null) {
        issues.push({ code: 'invalid_contract', path: ['destinations', index, 'assumptionId'] });
      }
    } else {
      const assumption = assumptionById(proposal.assumptions, destination.assumptionId);
      if (!assumption || assumption.code !== 'destination_inferred') {
        issues.push({ code: 'missing_assumption', path: ['destinations', index, 'assumptionId'] });
      }
      if (destination.destinationIntentId !== null) {
        issues.push({
          code: 'invalid_contract',
          path: ['destinations', index, 'destinationIntentId'],
        });
      }
    }
  });

  proposal.items.forEach((item, index) => {
    if (item.candidatePlaceId && !candidates.has(item.candidatePlaceId)) {
      issues.push({
        code: 'dangling_reference',
        path: ['items', index, 'candidatePlaceId'],
        subjectId: item.candidatePlaceId,
      });
    }
    if (item.destinationIntentId && !destinationIntents.has(item.destinationIntentId)) {
      issues.push({
        code: 'dangling_reference',
        path: ['items', index, 'destinationIntentId'],
        subjectId: item.destinationIntentId,
      });
    }
    item.constraintIds.forEach((constraintId) => {
      if (!constraints.has(constraintId)) {
        issues.push({
          code: 'dangling_reference',
          path: ['items', index, 'constraintIds'],
          subjectId: constraintId,
        });
      }
    });
    if (
      item.schedule.kind === 'exact' &&
      (item.origin === 'model' || !hasUserTimeConstraint(item, constraints))
    ) {
      issues.push({
        code: 'invented_exact_time',
        path: ['items', index, 'schedule'],
        subjectId: item.id,
      });
    }
    if (
      item.durationProvenance === 'user_owned' &&
      (item.origin === 'model' || !hasUserDurationConstraint(item, constraints))
    ) {
      issues.push({
        code: 'invalid_contract',
        path: ['items', index, 'durationProvenance'],
        subjectId: item.id,
      });
    }
    if (
      item.priority === 'must_go' &&
      (item.origin === 'model' || !hasUserMustGoConstraint(item, constraints))
    ) {
      issues.push({
        code: 'hard_constraint_changed',
        path: ['items', index, 'priority'],
        subjectId: item.id,
      });
    }
  });

  request.constraints.forEach((constraint, index) => {
    if (constraint.source === 'model' && constraint.strength === 'hard') {
      issues.push({
        code: 'hard_constraint_changed',
        path: ['normalizedRequest', 'constraints', index],
      });
    }
  });

  return issues;
}

export function validateAiPlannerModelProposal(
  value: unknown,
): AiPlannerValidationResult<AiPlannerModelProposal> {
  const parsed = parseAiPlannerModelProposal(value);
  if (!parsed.success) {
    return {
      issues: parsed.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      success: false,
    };
  }

  const issues = modelProposalRuleIssues(parsed.data);
  return issues.length > 0 ? { issues, success: false } : { data: parsed.data, success: true };
}

type LocatedDraftItem = {
  date: string | null;
  destinationId: string | null;
  item: AiPlannerDraftItem;
  path: PropertyKey[];
};

function allDraftItems(draft: AiPlannerDraft): LocatedDraftItem[] {
  return [
    ...draft.days.flatMap((day, dayIndex) =>
      day.items.map((item, itemIndex) => ({
        date: day.date,
        destinationId: day.destinationId,
        item,
        path: ['days', dayIndex, 'items', itemIndex],
      })),
    ),
    ...draft.unscheduledItems.map((item, index) => ({
      date: null,
      destinationId: null,
      item,
      path: ['unscheduledItems', index],
    })),
  ];
}

function hardConstraintIssues(draft: AiPlannerDraft, items: LocatedDraftItem[]) {
  const issues: AiPlannerRuleIssue[] = [];
  const hardConstraints = draft.normalizedRequest.constraints.filter(
    (constraint) => constraint.strength === 'hard',
  );
  const destinations = new Map(
    draft.trip.destinations.map((destination) => [destination.id, destination]),
  );

  hardConstraints.forEach((constraint) => {
    if (constraint.source !== 'user') {
      issues.push({
        code: 'hard_constraint_changed',
        path: ['normalizedRequest', 'constraints'],
        subjectId: constraint.id,
      });
      return;
    }

    const matches = items.filter(({ item }) => item.constraintIds.includes(constraint.id));
    if (matches.length === 0) {
      issues.push({ code: 'hard_constraint_missing', path: ['trip'], subjectId: constraint.id });
      return;
    }
    if (matches.some(({ date }) => date === null)) {
      issues.push({
        code: 'hard_constraint_unscheduled',
        path: ['unscheduledItems'],
        subjectId: constraint.id,
      });
    }

    const expectedBlockType = constraintBlockType(constraint.kind);
    const preserved =
      matches.length === 1 &&
      matches.every(({ date, destinationId, item }) => {
        if (date === null || item.blockType !== expectedBlockType) return false;
        if (constraint.date && date !== constraint.date) return false;
        if (
          constraint.destinationIntentId &&
          destinations.get(destinationId ?? '')?.destinationIntentId !==
            constraint.destinationIntentId
        ) {
          return false;
        }
        if (
          constraint.localTime &&
          (item.schedule.kind !== 'exact' || item.schedule.localTime !== constraint.localTime)
        ) {
          return false;
        }
        if (
          !constraint.localTime &&
          constraint.dayPart &&
          (item.schedule.kind !== 'day_part' || item.schedule.dayPart !== constraint.dayPart)
        ) {
          return false;
        }
        if (
          constraint.durationMinutes &&
          (item.durationMinutes !== constraint.durationMinutes ||
            item.durationProvenance !== 'user_owned')
        ) {
          return false;
        }
        if (constraint.kind === 'must_go' && item.priority !== 'must_go') return false;
        return true;
      });

    if (!preserved) {
      issues.push({ code: 'hard_constraint_changed', path: ['trip'], subjectId: constraint.id });
    }
  });

  const fixed = hardConstraints.flatMap((constraint) => {
    if (!constraint.date || !constraint.localTime || !constraint.durationMinutes) return [];
    return [
      {
        constraint,
        end: minuteOfDay(constraint.localTime) + constraint.durationMinutes,
        start: minuteOfDay(constraint.localTime),
      },
    ];
  });
  for (let left = 0; left < fixed.length; left += 1) {
    for (let right = left + 1; right < fixed.length; right += 1) {
      const a = fixed[left];
      const b = fixed[right];
      if (!a || !b || a.constraint.date !== b.constraint.date) continue;
      if (a.start < b.end && b.start < a.end) {
        issues.push({
          code: 'conflicting_hard_constraints',
          path: ['normalizedRequest', 'constraints'],
          subjectId: `${a.constraint.id}:${b.constraint.id}`,
        });
      }
    }
  }

  return issues;
}

function draftRuleIssues(draft: AiPlannerDraft) {
  const issues: AiPlannerRuleIssue[] = [];
  const items = allDraftItems(draft);
  const placeIds = new Set(draft.places.map((place) => place.id));
  const destinationIds = new Set(draft.trip.destinations.map((destination) => destination.id));
  const itemIds = new Set(items.map(({ item }) => item.id));
  const evidenceIds = new Set(draft.evidence.map((evidence) => evidence.id));
  const destinationIntentIds = new Set(
    draft.normalizedRequest.destinations.map((destination) => destination.id),
  );
  const constraints = new Map(
    draft.normalizedRequest.constraints.map((constraint) => [constraint.id, constraint]),
  );

  issues.push(...duplicateIssues(draft.places, ['places']));
  issues.push(...duplicateIssues(draft.trip.destinations, ['trip', 'destinations']));
  issues.push(
    ...duplicateIssues(
      items.map(({ item }) => item),
      ['items'],
    ),
  );
  issues.push(...duplicateIssues(draft.evidence, ['evidence']));
  issues.push(...duplicateIssues(draft.warnings, ['warnings']));
  issues.push(...duplicateIssues(draft.assumptions, ['assumptions']));

  let expectedDates: string[] = [];
  try {
    expectedDates = tripDates(draft.trip.startDate, draft.trip.endDate);
    if (expectedDates.length > AI_PLANNER_MAX_DAYS) {
      issues.push({ code: 'too_many_days', path: ['trip', 'endDate'] });
    }
  } catch (error) {
    issues.push({
      code: error instanceof AiPlannerRulesError ? error.code : 'invalid_date_range',
      path: ['trip'],
    });
  }

  if (
    expectedDates.length > 0 &&
    (draft.days.length !== expectedDates.length ||
      draft.days.some((day, index) => day.date !== expectedDates[index]))
  ) {
    issues.push({ code: 'invalid_date_range', path: ['days'] });
  }

  draft.trip.destinations.forEach((destination, index) => {
    if (!placeIds.has(destination.placeRefId)) {
      issues.push({
        code: 'dangling_reference',
        path: ['trip', 'destinations', index, 'placeRefId'],
      });
    }
    if (destination.source === 'user') {
      if (
        !destination.destinationIntentId ||
        !destinationIntentIds.has(destination.destinationIntentId)
      ) {
        issues.push({
          code: 'dangling_reference',
          path: ['trip', 'destinations', index, 'destinationIntentId'],
          subjectId: destination.destinationIntentId ?? undefined,
        });
      }
      if (destination.assumptionId !== null) {
        issues.push({
          code: 'invalid_contract',
          path: ['trip', 'destinations', index, 'assumptionId'],
        });
      }
    } else {
      const assumption = assumptionById(draft.assumptions, destination.assumptionId);
      if (!assumption || assumption.code !== 'destination_inferred') {
        issues.push({
          code: 'missing_assumption',
          path: ['trip', 'destinations', index, 'assumptionId'],
        });
      }
      if (destination.destinationIntentId !== null) {
        issues.push({
          code: 'invalid_contract',
          path: ['trip', 'destinations', index, 'destinationIntentId'],
        });
      }
    }
  });

  const sourcedAssumptions = [
    [draft.trip.dateSource, draft.trip.dateAssumptionId, 'dates_defaulted'],
    [draft.trip.nameSource, draft.trip.nameAssumptionId, 'trip_name_inferred'],
    [draft.trip.paceSource, draft.trip.paceAssumptionId, 'pace_defaulted'],
    [draft.trip.partySizeSource, draft.trip.partySizeAssumptionId, 'party_size_defaulted'],
  ] as const;
  sourcedAssumptions.forEach(([source, assumptionId, code], index) => {
    if (source === 'user') return;
    const assumption = assumptionById(draft.assumptions, assumptionId);
    if (!assumption || assumption.code !== code) {
      issues.push({ code: 'missing_assumption', path: ['trip', index] });
    }
  });

  draft.days.forEach((day, dayIndex) => {
    if (day.destinationId && !destinationIds.has(day.destinationId)) {
      issues.push({ code: 'dangling_reference', path: ['days', dayIndex, 'destinationId'] });
    }
    [day.dailyBasePlaceRefId, day.dailyBaseDeparturePlaceRefId].forEach((placeRefId) => {
      if (placeRefId && !placeIds.has(placeRefId)) {
        issues.push({
          code: 'dangling_reference',
          path: ['days', dayIndex],
          subjectId: placeRefId,
        });
      }
    });
  });

  items.forEach(({ item, path }) => {
    if (item.placeRefId && !placeIds.has(item.placeRefId)) {
      issues.push({
        code: 'dangling_reference',
        path: [...path, 'placeRefId'],
        subjectId: item.placeRefId,
      });
    }
    item.constraintIds.forEach((constraintId) => {
      if (!constraints.has(constraintId)) {
        issues.push({
          code: 'dangling_reference',
          path: [...path, 'constraintIds'],
          subjectId: constraintId,
        });
      }
    });
    if (
      item.schedule.kind === 'exact' &&
      (item.origin === 'model' || !hasUserTimeConstraint(item, constraints))
    ) {
      issues.push({ code: 'invented_exact_time', path: [...path, 'schedule'], subjectId: item.id });
    }
    if (
      item.durationProvenance === 'user_owned' &&
      (item.origin === 'model' || !hasUserDurationConstraint(item, constraints))
    ) {
      issues.push({
        code: 'invalid_contract',
        path: [...path, 'durationProvenance'],
        subjectId: item.id,
      });
    }
    if (
      item.priority === 'must_go' &&
      (item.origin === 'model' || !hasUserMustGoConstraint(item, constraints))
    ) {
      issues.push({
        code: 'hard_constraint_changed',
        path: [...path, 'priority'],
        subjectId: item.id,
      });
    }
  });

  const realPlaceItems = items.filter(({ item }) => {
    if (!item.placeRefId) return false;
    return draft.places.find((place) => place.id === item.placeRefId)?.resolution === 'verified';
  });
  if (realPlaceItems.length > AI_PLANNER_MAX_REAL_PLACE_ITEMS) {
    issues.push({ code: 'too_many_real_place_items', path: ['days'] });
  }

  draft.evidence.forEach((evidence, index) => {
    const validSubject =
      evidence.subjectType === 'place'
        ? placeIds.has(evidence.subjectId)
        : evidence.subjectType === 'item'
          ? itemIds.has(evidence.subjectId)
          : evidence.subjectType === 'destination'
            ? destinationIds.has(evidence.subjectId)
            : true;
    if (!validSubject) {
      issues.push({ code: 'dangling_reference', path: ['evidence', index, 'subjectId'] });
    }
    if (evidence.status === 'verified' && (!evidence.provider || !evidence.checkedAt)) {
      issues.push({ code: 'invalid_evidence', path: ['evidence', index] });
    }
  });

  draft.warnings.forEach((warning, index) => {
    warning.itemIds.forEach((itemId) => {
      if (!itemIds.has(itemId)) {
        issues.push({
          code: 'dangling_reference',
          path: ['warnings', index, 'itemIds'],
          subjectId: itemId,
        });
      }
    });
    warning.evidenceIds.forEach((evidenceId) => {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({
          code: 'dangling_reference',
          path: ['warnings', index, 'evidenceIds'],
          subjectId: evidenceId,
        });
      }
    });
  });

  issues.push(...hardConstraintIssues(draft, items));
  return issues;
}

export function validateAiPlannerDraft(value: unknown): AiPlannerValidationResult<AiPlannerDraft> {
  const parsed = parseAiPlannerDraft(value);
  if (!parsed.success) {
    return {
      issues: parsed.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      success: false,
    };
  }

  const issues = draftRuleIssues(parsed.data);
  return issues.length > 0 ? { issues, success: false } : { data: parsed.data, success: true };
}
