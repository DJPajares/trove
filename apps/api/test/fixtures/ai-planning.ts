import type {
  AiPlannerDraft,
  AiPlannerModelProposal,
  AiPlannerNormalizedRequest,
} from '@trove/types';
import { buildPlanScoreFromEvaluations } from '../../src/services/plan-score.js';

const TOKYO_PLACE_ID = '0199a6f8-6e28-7a31-b11c-45db8dc98611';
const KYOTO_PLACE_ID = '0199a6f8-6e28-7a31-b11c-45db8dc98612';

export const aiPlanningPrompts = {
  ambiguous: 'Somewhere warm next month with good food.',
  contradictory: 'Meet Pat at 09:00 for two hours and Sam at 10:00 for two hours.',
  explicit: 'Tokyo from October 2 to 4 for two people. Team meeting at 09:00 on Saturday.',
  invalidOutput: 'Create a trip and also add a task and a restaurant booking.',
  missing: 'Plan me a food trip and suggest where to go.',
  multiDestination: 'Tokyo and Kyoto with a work block and the train between them.',
} as const;

export function explicitNormalizedRequest(): AiPlannerNormalizedRequest {
  return {
    constraints: [
      {
        date: '2026-10-03',
        dayPart: null,
        destinationIntentId: 'destination:tokyo',
        durationMinutes: 60,
        id: 'constraint:meeting',
        kind: 'meeting',
        label: 'Team meeting',
        localTime: '09:00',
        priority: null,
        source: 'user',
        strength: 'hard',
      },
      {
        date: null,
        dayPart: null,
        destinationIntentId: 'destination:tokyo',
        durationMinutes: null,
        id: 'constraint:must-go',
        kind: 'must_go',
        label: 'Tokyo National Museum',
        localTime: null,
        priority: 'must_go',
        source: 'user',
        strength: 'hard',
      },
    ],
    datePreference: { endDate: '2026-10-04', kind: 'exact', startDate: '2026-10-02' },
    destinations: [{ id: 'destination:tokyo', name: 'Tokyo' }],
    interests: ['food', 'museums'],
    pace: 'balanced',
    partySize: 2,
    schemaVersion: 1,
    tripName: 'Tokyo focus trip',
  };
}

export function explicitModelProposal(): AiPlannerModelProposal {
  return {
    assumptions: [],
    destinations: [
      {
        assumptionId: null,
        candidatePlaceId: 'candidate:tokyo',
        destinationIntentId: 'destination:tokyo',
        source: 'user',
      },
    ],
    items: [
      {
        blockType: 'meeting',
        candidatePlaceId: null,
        constraintIds: ['constraint:meeting'],
        dayIndex: 1,
        destinationIntentId: 'destination:tokyo',
        durationMinutes: 60,
        durationProvenance: 'user_owned',
        id: 'item:meeting',
        isAnchor: false,
        label: 'Team meeting',
        notes: null,
        origin: 'user',
        priority: null,
        schedule: { kind: 'exact', localTime: '09:00', source: 'user' },
      },
      {
        blockType: 'activity',
        candidatePlaceId: 'candidate:museum',
        constraintIds: ['constraint:must-go'],
        dayIndex: 1,
        destinationIntentId: 'destination:tokyo',
        durationMinutes: 120,
        durationProvenance: 'ai_estimated',
        id: 'item:museum',
        isAnchor: true,
        label: 'Tokyo National Museum',
        notes: null,
        origin: 'user',
        priority: 'must_go',
        schedule: { dayPart: 'afternoon', kind: 'day_part' },
      },
    ],
    normalizedRequest: explicitNormalizedRequest(),
    partySize: 2,
    places: [
      { id: 'candidate:tokyo', name: 'Tokyo', note: null, searchQuery: 'Tokyo Japan' },
      {
        id: 'candidate:museum',
        name: 'Tokyo National Museum',
        note: null,
        searchQuery: 'Tokyo National Museum Tokyo',
      },
    ],
    schemaVersion: 1,
    selectedDurationDays: null,
    tripName: 'Tokyo focus trip',
  };
}

function verifiedPlace(id: string, name: string, placeId: string) {
  return {
    attributions: [],
    id,
    name,
    placeId,
    provider: 'google' as const,
    resolution: 'verified' as const,
  };
}

function identityEvidence(id: string, subjectId: string) {
  return {
    checkedAt: '2026-08-30T12:00:00.000Z',
    code: null,
    id,
    kind: 'identity' as const,
    provider: 'google',
    status: 'verified' as const,
    subjectId,
    subjectType: 'place' as const,
  };
}

export function explicitDraft(): AiPlannerDraft {
  return {
    assumptions: [],
    days: [
      {
        dailyBaseDeparturePlaceRefId: null,
        dailyBasePlaceRefId: null,
        date: '2026-10-02',
        destinationId: 'draft-destination:tokyo',
        items: [],
      },
      {
        dailyBaseDeparturePlaceRefId: null,
        dailyBasePlaceRefId: null,
        date: '2026-10-03',
        destinationId: 'draft-destination:tokyo',
        items: [
          {
            blockType: 'meeting',
            constraintIds: ['constraint:meeting'],
            durationMinutes: 60,
            durationProvenance: 'user_owned',
            id: 'item:meeting',
            isAnchor: false,
            label: 'Team meeting',
            notes: null,
            origin: 'user',
            placeRefId: null,
            priority: null,
            schedule: { kind: 'exact', localTime: '09:00', source: 'user' },
          },
          {
            blockType: 'activity',
            constraintIds: ['constraint:must-go'],
            durationMinutes: 120,
            durationProvenance: 'ai_estimated',
            id: 'item:museum',
            isAnchor: true,
            label: 'Tokyo National Museum',
            notes: null,
            origin: 'user',
            placeRefId: 'place:museum',
            priority: 'must_go',
            schedule: { dayPart: 'afternoon', kind: 'day_part' },
          },
        ],
      },
      {
        dailyBaseDeparturePlaceRefId: null,
        dailyBasePlaceRefId: null,
        date: '2026-10-04',
        destinationId: 'draft-destination:tokyo',
        items: [],
      },
    ],
    evidence: [
      identityEvidence('evidence:tokyo', 'place:tokyo'),
      identityEvidence('evidence:museum', 'place:museum'),
    ],
    normalizedRequest: explicitNormalizedRequest(),
    places: [
      verifiedPlace('place:tokyo', 'Tokyo', TOKYO_PLACE_ID),
      verifiedPlace(
        'place:museum',
        'Tokyo National Museum',
        '0199a6f8-6e28-7a31-b11c-45db8dc98613',
      ),
    ],
    schemaVersion: 1,
    trip: {
      dateAssumptionId: null,
      dateSource: 'user',
      destinations: [
        {
          assumptionId: null,
          destinationIntentId: 'destination:tokyo',
          id: 'draft-destination:tokyo',
          placeRefId: 'place:tokyo',
          source: 'user',
        },
      ],
      endDate: '2026-10-04',
      name: 'Tokyo focus trip',
      nameAssumptionId: null,
      nameSource: 'user',
      pace: 'balanced',
      paceAssumptionId: null,
      paceSource: 'user',
      partySize: 2,
      partySizeAssumptionId: null,
      partySizeSource: 'user',
      startDate: '2026-10-02',
    },
    unscheduledItems: [],
    warnings: [],
  };
}

export function missingDetailsProposal(): AiPlannerModelProposal {
  const normalizedRequest: AiPlannerNormalizedRequest = {
    constraints: [],
    datePreference: { kind: 'missing' },
    destinations: [],
    interests: ['food'],
    pace: null,
    partySize: null,
    schemaVersion: 1,
    tripName: null,
  };

  return {
    assumptions: [
      {
        code: 'destination_inferred',
        fieldPath: 'trip.destinations[0]',
        id: 'assumption:destination',
        rationale: 'Kyoto fits the requested food focus and selected trip length.',
        value: 'Kyoto',
      },
      {
        code: 'trip_name_inferred',
        fieldPath: 'trip.name',
        id: 'assumption:name',
        rationale: 'The name summarizes the inferred destination and interest.',
        value: 'Kyoto food trip',
      },
    ],
    destinations: [
      {
        assumptionId: 'assumption:destination',
        candidatePlaceId: 'candidate:kyoto',
        destinationIntentId: null,
        source: 'model',
      },
    ],
    items: [],
    normalizedRequest,
    partySize: null,
    places: [{ id: 'candidate:kyoto', name: 'Kyoto', note: null, searchQuery: 'Kyoto Japan' }],
    schemaVersion: 1,
    selectedDurationDays: 5,
    tripName: 'Kyoto food trip',
  };
}

export function ambiguousModelProposal(): AiPlannerModelProposal {
  const proposal = missingDetailsProposal();
  proposal.normalizedRequest.datePreference = {
    earliestStartDate: '2026-09-01',
    kind: 'flexible',
    latestEndDate: '2026-09-30',
  };
  proposal.selectedDurationDays = 3;
  return proposal;
}

export function contradictoryDraft(): AiPlannerDraft {
  const draft = explicitDraft();
  const secondConstraint = {
    ...draft.normalizedRequest.constraints[0]!,
    durationMinutes: 120,
    id: 'constraint:overlap',
    label: 'Overlapping meeting',
    localTime: '09:30',
  };
  draft.normalizedRequest.constraints[0]!.durationMinutes = 120;
  draft.normalizedRequest.constraints.push(secondConstraint);
  draft.days[1]!.items.push({
    blockType: 'meeting',
    constraintIds: ['constraint:overlap'],
    durationMinutes: 120,
    durationProvenance: 'user_owned',
    id: 'item:overlap',
    isAnchor: false,
    label: 'Overlapping meeting',
    notes: null,
    origin: 'user',
    placeRefId: null,
    priority: null,
    schedule: { kind: 'exact', localTime: '09:30', source: 'user' },
  });
  return draft;
}

export function multiDestinationDraft(): AiPlannerDraft {
  const draft = explicitDraft();
  draft.normalizedRequest.destinations.push({ id: 'destination:kyoto', name: 'Kyoto' });
  draft.places.push(verifiedPlace('place:kyoto', 'Kyoto', KYOTO_PLACE_ID));
  draft.evidence.push(identityEvidence('evidence:kyoto', 'place:kyoto'));
  draft.trip.destinations.push({
    assumptionId: null,
    destinationIntentId: 'destination:kyoto',
    id: 'draft-destination:kyoto',
    placeRefId: 'place:kyoto',
    source: 'user',
  });
  draft.days[2]!.destinationId = 'draft-destination:kyoto';
  draft.days[2]!.items.push(
    {
      blockType: 'transport',
      constraintIds: [],
      durationMinutes: 140,
      durationProvenance: 'ai_estimated',
      id: 'item:train',
      isAnchor: false,
      label: 'Train to Kyoto',
      notes: null,
      origin: 'model',
      placeRefId: null,
      priority: null,
      schedule: { dayPart: 'morning', kind: 'day_part' },
    },
    {
      blockType: 'work',
      constraintIds: [],
      durationMinutes: 120,
      durationProvenance: 'ai_estimated',
      id: 'item:work',
      isAnchor: false,
      label: 'Work block',
      notes: null,
      origin: 'model',
      placeRefId: null,
      priority: null,
      schedule: { dayPart: 'afternoon', kind: 'day_part' },
    },
    {
      blockType: 'free_time',
      constraintIds: [],
      durationMinutes: 60,
      durationProvenance: 'ai_estimated',
      id: 'item:free-time',
      isAnchor: false,
      label: 'Free time',
      notes: null,
      origin: 'model',
      placeRefId: null,
      priority: null,
      schedule: { dayPart: 'evening', kind: 'day_part' },
    },
  );
  return draft;
}

export function customPlaceDraft(): AiPlannerDraft {
  const draft = explicitDraft();
  draft.places.push({
    id: 'place:custom',
    name: 'Quiet neighborhood viewpoint',
    note: 'Ask locally for the best access point.',
    resolution: 'custom',
    verification: 'not_checked',
  });
  draft.unscheduledItems.push({
    blockType: 'activity',
    constraintIds: [],
    durationMinutes: 60,
    durationProvenance: 'ai_estimated',
    id: 'item:custom',
    isAnchor: true,
    label: 'Quiet neighborhood viewpoint',
    notes: null,
    origin: 'model',
    placeRefId: 'place:custom',
    priority: 'maybe',
    schedule: { dayPart: 'anytime', kind: 'day_part' },
  });
  draft.evidence.push({
    checkedAt: null,
    code: 'provider_cap_reached',
    id: 'evidence:custom',
    kind: 'identity',
    provider: null,
    status: 'not_checked',
    subjectId: 'place:custom',
    subjectType: 'place',
  });
  draft.warnings.push({
    code: 'custom_place_not_checked',
    evidenceIds: ['evidence:custom'],
    id: 'warning:custom',
    itemIds: ['item:custom'],
    material: false,
  });
  return draft;
}

/**
 * A real, empty score rather than a hand-written literal, so the fixture cannot
 * drift from the payload the scorer actually produces.
 */
export function emptyPlanScore() {
  return buildPlanScoreFromEvaluations({ days: [], mustGoIds: [], scheduledIds: [] });
}
