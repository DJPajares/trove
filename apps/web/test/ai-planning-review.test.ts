import { expect, test } from 'vitest';

import type { AiPlanningDraft, AiPlanningSession } from '../lib/ai-planning/api.ts';
import {
  activeAiPlanningAssumptions,
  aiPlanningAssumptionMessageValues,
  aiPlanningReviewPageState,
  appliedAiPlanningSession,
  releasesMirroredAiPlanningSession,
  buildAiPlanningReviewMapPoints,
} from '../lib/ai-planning/review.ts';

function reviewDraft(): AiPlanningDraft {
  return {
    assumptions: [],
    days: [
      {
        dailyBaseDeparturePlaceRefId: null,
        dailyBasePlaceRefId: null,
        date: '2026-10-03',
        destinationId: null,
        items: [
          {
            blockType: 'activity',
            constraintIds: [],
            durationMinutes: 90,
            durationProvenance: 'ai_estimated',
            id: 'item:verified',
            isAnchor: false,
            label: 'Verified museum',
            notes: null,
            origin: 'model',
            placeRefId: 'place:verified',
            priority: null,
            schedule: { dayPart: 'afternoon', kind: 'day_part' },
          },
        ],
      },
    ],
    evidence: [],
    normalizedRequest: {},
    places: [
      {
        attributions: [],
        id: 'place:verified',
        location: { latitude: 35.71, longitude: 139.77 },
        name: 'Verified museum',
        placeId: '00000000-0000-4000-8000-000000000020',
        provider: 'google',
        resolution: 'verified',
      },
      {
        id: 'place:custom',
        name: 'My cousin’s café',
        note: null,
        resolution: 'custom',
        verification: 'unverified',
      },
      {
        attributions: [],
        id: 'place:legacy',
        name: 'Older verified place',
        placeId: '00000000-0000-4000-8000-000000000021',
        provider: 'google',
        resolution: 'verified',
      },
    ],
    schemaVersion: 1,
    trip: {
      dateAssumptionId: null,
      dateSource: 'user',
      description: 'Two nights in Tokyo, built around one long dinner.',
      destinations: [],
      endDate: '2026-10-03',
      name: 'Tokyo review',
      nameAssumptionId: null,
      nameSource: 'user',
      pace: 'balanced',
      paceAssumptionId: null,
      paceSource: 'user',
      partySize: 1,
      partySizeAssumptionId: null,
      partySizeSource: 'user',
      startDate: '2026-10-03',
    },
    unscheduledItems: [],
    warnings: [],
  };
}

test('review maps use only provider-derived coordinates and preserve item order', () => {
  expect(buildAiPlanningReviewMapPoints(reviewDraft())).toStrictEqual([
    expect.objectContaining({
      id: 'place:verified',
      itemId: 'item:verified',
      kind: 'scheduled',
      order: 1,
    }),
  ]);
});

test('assumption copy values come from structured values instead of model rationale', () => {
  const draft = reviewDraft();
  draft.trip.name = 'Tokyo autumn';
  draft.trip.partySize = 2;
  const assumption = {
    code: 'trip_name_inferred' as const,
    fieldPath: 'trip.name',
    id: 'assumption:name',
    rationale: 'The user did not provide a trip name.',
    value: 'AI suggested name',
  };

  expect(aiPlanningAssumptionMessageValues(assumption, draft, 'en')).toMatchObject({
    count: 2,
    name: 'AI suggested name',
  });
});

test('only assumptions still active in the reviewed draft are presented', () => {
  const draft = reviewDraft();
  draft.assumptions = [
    {
      code: 'trip_name_inferred',
      fieldPath: 'trip.name',
      id: 'assumption:name',
      rationale: null,
      value: 'Suggested name',
    },
    {
      code: 'interest_inferred',
      fieldPath: 'normalizedRequest.interests[0]',
      id: 'assumption:interest',
      rationale: null,
      value: 'food',
    },
  ];

  expect(activeAiPlanningAssumptions(draft).map((assumption) => assumption.id)).toStrictEqual([
    'assumption:interest',
  ]);
  draft.trip.nameAssumptionId = 'assumption:name';
  expect(activeAiPlanningAssumptions(draft).map((assumption) => assumption.id)).toStrictEqual([
    'assumption:name',
    'assumption:interest',
  ]);
});

test('a review session with an initializing local draft stays in loading', () => {
  const draft = reviewDraft();
  const session = {
    appliedTripId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    draft,
    draftRevision: 1,
    expiresAt: '2026-09-08T00:00:00.000Z',
    id: 'session:review',
    lastSafeError: null,
    pendingRunId: null,
    planScore: null,
    prompt: 'Tokyo',
    schemaVersion: 1,
    stage: 'reviewing' as const,
    status: 'reviewing' as const,
    tripDescription: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    warningAcknowledgement: null,
  };

  expect(aiPlanningReviewPageState(session, null, false)).toBe('loading');
  expect(aiPlanningReviewPageState(session, draft, false)).toBe('reviewing');
  expect(
    aiPlanningReviewPageState(
      { ...session, status: 'applied', appliedTripId: 'trip:1' },
      null,
      false,
    ),
  ).toBe('redirecting');
});

test('an applied session drops its draft so the review page cannot render one again', () => {
  const draft = reviewDraft();
  const session = {
    appliedTripId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    draft,
    draftRevision: 4,
    expiresAt: '2026-09-08T00:00:00.000Z',
    id: 'session:review',
    lastSafeError: null,
    pendingRunId: null,
    planScore: null,
    prompt: 'Tokyo',
    schemaVersion: 1,
    stage: 'reviewing' as const,
    status: 'reviewing' as const,
    tripDescription: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    warningAcknowledgement: { acknowledgedAt: '2026-09-01T00:00:00.000Z', revision: 4 },
  };

  const applied = appliedAiPlanningSession(session, 'trip:1');

  expect(applied).toMatchObject({
    appliedTripId: 'trip:1',
    draft: null,
    draftRevision: 4,
    id: 'session:review',
    stage: 'complete',
    status: 'applied',
    warningAcknowledgement: null,
  });
  expect(session.draft).toBe(draft);
  expect(aiPlanningReviewPageState(applied, null, false)).toBe('redirecting');
});

test('a mirrored session is released exactly when recovery lets go of it', () => {
  const reviewing = { id: 'session:review' } as AiPlanningSession;

  // Apply empties the recovery cache. The mirror following that session has to
  // let go with it, or it pins the traveller back to the draft on the very
  // navigation Apply just made and loops against the review page's own redirect.
  expect(releasesMirroredAiPlanningSession(reviewing, 'session:review', null)).toBe(true);

  // Recovery still holds it: nothing has been let go of.
  expect(releasesMirroredAiPlanningSession(reviewing, 'session:review', 'session:review')).toBe(
    false,
  );

  // A run this hook started is deliberately ahead of recovery, so a mirror that
  // has already moved on must survive an older session being dropped.
  expect(
    releasesMirroredAiPlanningSession(
      { id: 'session:next' } as AiPlanningSession,
      'session:review',
      null,
    ),
  ).toBe(false);

  // Nothing was being followed, and nothing is being followed now.
  expect(releasesMirroredAiPlanningSession(reviewing, null, null)).toBe(false);
  expect(releasesMirroredAiPlanningSession(null, 'session:review', null)).toBe(false);
});
