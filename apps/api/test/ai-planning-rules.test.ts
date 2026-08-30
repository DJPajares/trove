import type { AiPlannerDraftItem } from '@trove/types';
import { expect, test } from 'vitest';

import {
  balancedPaceAnchorRange,
  resolveAiPlannerDateRange,
  resolveAiPlannerDefaults,
  validateAiPlannerDraft,
  validateAiPlannerModelProposal,
} from '../src/services/ai-planning-rules.js';
import {
  ambiguousModelProposal,
  aiPlanningPrompts,
  contradictoryDraft,
  customPlaceDraft,
  explicitDraft,
  explicitModelProposal,
  explicitNormalizedRequest,
  missingDetailsProposal,
  multiDestinationDraft,
} from './fixtures/ai-planning.js';

function issueCodes(result: ReturnType<typeof validateAiPlannerDraft>) {
  return result.success ? [] : result.issues.map((issue) => issue.code);
}

test('exact date ranges remain unchanged and do not create an assumption', () => {
  expect(resolveAiPlannerDateRange(explicitNormalizedRequest(), null, '2026-08-30')).toStrictEqual({
    assumption: null,
    endDate: '2026-10-04',
    source: 'user',
    startDate: '2026-10-02',
  });
});

test('missing dates use the selected tier and next Friday at least fourteen days away', () => {
  const proposal = missingDetailsProposal();

  expect(
    resolveAiPlannerDateRange(
      proposal.normalizedRequest,
      proposal.selectedDurationDays,
      '2026-08-30',
    ),
  ).toStrictEqual({
    assumption: {
      code: 'dates_defaulted',
      fieldPath: 'trip.dates',
      id: 'system:dates-defaulted',
      rationale: null,
      value: ['2026-09-18', '2026-09-22'],
    },
    endDate: '2026-09-22',
    source: 'default',
    startDate: '2026-09-18',
  });
});

test('missing duration tiers fail instead of allowing the model to invent dates', () => {
  const proposal = missingDetailsProposal();

  expect(() =>
    resolveAiPlannerDateRange(proposal.normalizedRequest, null, '2026-08-30'),
  ).toThrowError('missing_duration_tier');
});

test('flexible date windows constrain the deterministic Friday selection', () => {
  const proposal = ambiguousModelProposal();

  expect(
    resolveAiPlannerDateRange(
      proposal.normalizedRequest,
      proposal.selectedDurationDays,
      '2026-08-30',
    ),
  ).toMatchObject({ endDate: '2026-09-20', startDate: '2026-09-18' });
  expect(validateAiPlannerModelProposal(proposal).success).toBe(true);

  if (proposal.normalizedRequest.datePreference.kind !== 'flexible') {
    throw new Error('Expected flexible date fixture.');
  }
  proposal.normalizedRequest.datePreference.latestEndDate = '2026-09-19';
  expect(() =>
    resolveAiPlannerDateRange(
      proposal.normalizedRequest,
      proposal.selectedDurationDays,
      '2026-08-30',
    ),
  ).toThrowError('invalid_date_range');
});

test('defaults party size and pace while preserving model-disclosed destination and name assumptions', () => {
  const proposal = missingDetailsProposal();
  const defaults = resolveAiPlannerDefaults(proposal.normalizedRequest, proposal, '2026-08-30');

  expect(defaults).toMatchObject({
    dateSource: 'default',
    endDate: '2026-09-22',
    name: 'Kyoto food trip',
    nameAssumptionId: 'assumption:name',
    nameSource: 'model',
    pace: 'balanced',
    paceAssumptionId: 'system:pace-defaulted',
    paceSource: 'default',
    partySize: 1,
    partySizeAssumptionId: 'system:party-size-defaulted',
    partySizeSource: 'default',
    startDate: '2026-09-18',
  });
  expect(defaults.assumptions.map((assumption) => assumption.code)).toEqual(
    expect.arrayContaining([
      'destination_inferred',
      'trip_name_inferred',
      'dates_defaulted',
      'pace_defaulted',
      'party_size_defaulted',
    ]),
  );
  expect(aiPlanningPrompts.missing).toContain('suggest');
  expect(aiPlanningPrompts.ambiguous).toContain('Somewhere');
});

test('balanced pace keeps arrival and departure lighter than full days', () => {
  expect(balancedPaceAnchorRange(0, 5)).toStrictEqual({ maximum: 2, minimum: 0 });
  expect(balancedPaceAnchorRange(1, 5)).toStrictEqual({ maximum: 3, minimum: 2 });
  expect(balancedPaceAnchorRange(4, 5)).toStrictEqual({ maximum: 2, minimum: 0 });
  expect(() => balancedPaceAnchorRange(5, 5)).toThrowError('invalid_day_index');
});

test('the explicit fixture preserves fixed times, Must Go priority, and user duration', () => {
  const result = validateAiPlannerDraft(explicitDraft());

  expect(result.success).toBe(true);
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  const items = result.data.days.flatMap((day) => day.items);
  expect(items).toContainEqual(
    expect.objectContaining({
      durationMinutes: 60,
      durationProvenance: 'user_owned',
      schedule: { kind: 'exact', localTime: '09:00', source: 'user' },
    }),
  );
  expect(items).toContainEqual(expect.objectContaining({ priority: 'must_go' }));
});

test('hard commitments cannot move, become Unscheduled, or lose their supplied time', () => {
  const moved = explicitDraft();
  const meeting = moved.days[1]!.items.shift();
  if (!meeting) throw new Error('Expected meeting fixture.');
  moved.unscheduledItems.push(meeting);

  expect(issueCodes(validateAiPlannerDraft(moved))).toEqual(
    expect.arrayContaining(['hard_constraint_unscheduled', 'hard_constraint_changed']),
  );

  const changed = explicitDraft();
  const changedMeeting = changed.days[1]!.items[0]!;
  changedMeeting.schedule = { kind: 'exact', localTime: '10:00', source: 'user' };
  expect(issueCodes(validateAiPlannerDraft(changed))).toContain('hard_constraint_changed');

  const wrongDestination = multiDestinationDraft();
  wrongDestination.days[1]!.destinationId = 'draft-destination:kyoto';
  expect(issueCodes(validateAiPlannerDraft(wrongDestination))).toContain('hard_constraint_changed');
});

test('contradictory exact commitments are rejected deterministically', () => {
  expect(issueCodes(validateAiPlannerDraft(contradictoryDraft()))).toContain(
    'conflicting_hard_constraints',
  );
  expect(aiPlanningPrompts.contradictory).toContain('09:00');
});

test('model suggestions use day parts and AI-estimated durations', () => {
  const proposal = explicitModelProposal();
  proposal.items.push({
    blockType: 'activity',
    candidatePlaceId: null,
    constraintIds: [],
    dayIndex: 0,
    destinationIntentId: 'destination:tokyo',
    durationMinutes: 90,
    durationProvenance: 'ai_estimated',
    id: 'item:model-suggestion',
    isAnchor: true,
    label: 'Neighborhood walk',
    notes: null,
    origin: 'model',
    priority: null,
    schedule: { dayPart: 'afternoon', kind: 'day_part' },
  });

  expect(validateAiPlannerModelProposal(proposal).success).toBe(true);

  const invented = structuredClone(proposal);
  invented.items.at(-1)!.schedule = {
    kind: 'exact',
    localTime: '13:15',
    source: 'user',
  };
  expect(validateAiPlannerModelProposal(invented)).toMatchObject({
    issues: expect.arrayContaining([expect.objectContaining({ code: 'invented_exact_time' })]),
    success: false,
  });

  const falselyAttributed = explicitModelProposal();
  falselyAttributed.items[0]!.constraintIds = ['constraint:must-go'];
  expect(validateAiPlannerModelProposal(falselyAttributed)).toMatchObject({
    issues: expect.arrayContaining([expect.objectContaining({ code: 'invented_exact_time' })]),
    success: false,
  });

  const inventedMustGo = structuredClone(proposal);
  inventedMustGo.items.at(-1)!.priority = 'must_go';
  expect(validateAiPlannerModelProposal(inventedMustGo)).toMatchObject({
    issues: expect.arrayContaining([expect.objectContaining({ code: 'hard_constraint_changed' })]),
    success: false,
  });
});

test('work, transport, and free time remain ordinary draft items in a multi-destination trip', () => {
  const result = validateAiPlannerDraft(multiDestinationDraft());

  expect(result.success).toBe(true);
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  expect(result.data.trip.destinations).toHaveLength(2);
  expect(result.data.days.flatMap((day) => day.items).map((item) => item.blockType)).toEqual(
    expect.arrayContaining(['work', 'transport', 'free_time']),
  );
  expect(aiPlanningPrompts.multiDestination).toContain('Tokyo and Kyoto');
});

test('Custom Places and label blocks do not consume the real-place item limit', () => {
  const draft = customPlaceDraft();
  const template = draft.unscheduledItems[0]!;
  draft.unscheduledItems = Array.from({ length: 30 }, (_, index) => ({
    ...structuredClone(template),
    id: index === 0 ? template.id : `item:custom:${index}`,
  }));

  expect(validateAiPlannerDraft(draft).success).toBe(true);
});

test('drafts beyond fourteen days or twenty-four real-place items are rejected', () => {
  const tooLong = explicitDraft();
  tooLong.trip.endDate = '2026-10-16';
  tooLong.days = Array.from({ length: 15 }, (_, index) => ({
    dailyBaseDeparturePlaceRefId: null,
    dailyBasePlaceRefId: null,
    date: `2026-10-${String(index + 2).padStart(2, '0')}`,
    destinationId: 'draft-destination:tokyo',
    items: [],
  }));
  expect(issueCodes(validateAiPlannerDraft(tooLong))).toContain('too_many_days');

  const tooManyPlaces = explicitDraft();
  const template = tooManyPlaces.days[1]!.items[1]!;
  tooManyPlaces.normalizedRequest.constraints = tooManyPlaces.normalizedRequest.constraints.filter(
    (constraint) => constraint.id !== 'constraint:must-go',
  );
  tooManyPlaces.days[1]!.items = [tooManyPlaces.days[1]!.items[0]!];
  tooManyPlaces.days[0]!.items = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(template),
    constraintIds: [],
    id: `item:real:${index}`,
    origin: 'model',
    priority: 'interested',
  })) as AiPlannerDraftItem[];

  expect(issueCodes(validateAiPlannerDraft(tooManyPlaces))).toContain('too_many_real_place_items');
});

test('dangling references, missing assumptions, and unsupported versions fail safely', () => {
  const dangling = explicitDraft();
  dangling.days[0]!.dailyBasePlaceRefId = 'place:missing';
  expect(issueCodes(validateAiPlannerDraft(dangling))).toContain('dangling_reference');

  const missingAssumption = customPlaceDraft();
  missingAssumption.trip.dateSource = 'default';
  missingAssumption.trip.dateAssumptionId = null;
  expect(issueCodes(validateAiPlannerDraft(missingAssumption))).toContain('missing_assumption');

  const version = { ...explicitDraft(), schemaVersion: 99 };
  expect(issueCodes(validateAiPlannerDraft(version))).toContain('unsupported_schema_version');
});
