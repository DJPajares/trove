import {
  aiPlannerDraftSchema,
  aiPlannerModelProposalSchema,
  parseAiPlannerDraft,
  parseAiPlannerModelProposal,
  parseAiPlannerNormalizedRequest,
} from '@trove/types';
import { expect, test } from 'vitest';

import {
  aiPlanningPrompts,
  customPlaceDraft,
  explicitDraft,
  explicitModelProposal,
  explicitNormalizedRequest,
} from './fixtures/ai-planning.js';

test('version 1 request, model proposal, and reviewed draft contracts parse', () => {
  expect(parseAiPlannerNormalizedRequest(explicitNormalizedRequest()).success).toBe(true);
  expect(parseAiPlannerModelProposal(explicitModelProposal()).success).toBe(true);
  expect(parseAiPlannerDraft(explicitDraft()).success).toBe(true);
});

test('version 1 drafts accept application-estimated exact times but model proposals do not', () => {
  const draft = explicitDraft();
  draft.days[1]!.items[1]!.schedule = {
    kind: 'exact',
    localTime: '13:15',
    source: 'model',
  };
  expect(parseAiPlannerDraft(draft).success).toBe(true);

  const proposal = explicitModelProposal() as unknown as {
    items: Array<{ schedule: unknown }>;
  };
  proposal.items[1]!.schedule = {
    kind: 'exact',
    localTime: '13:15',
    source: 'model',
  };
  expect(parseAiPlannerModelProposal(proposal).success).toBe(false);
});

test('unknown contract versions are rejected before shape validation', () => {
  const request = { ...explicitNormalizedRequest(), schemaVersion: 2 };
  const result = parseAiPlannerNormalizedRequest(request);

  expect(result).toStrictEqual({
    issues: [
      {
        code: 'unsupported_schema_version',
        message: 'unsupported_schema_version',
        path: ['schemaVersion'],
      },
    ],
    success: false,
  });
});

test('strict drafts reject unsupported Tasks, reservations, and other entity creation', () => {
  const draft = {
    ...explicitDraft(),
    reservations: [],
    tasks: [{ label: 'Book dinner' }],
  };

  expect(aiPlannerDraftSchema.safeParse(draft).success).toBe(false);
  expect(aiPlanningPrompts.invalidOutput).toContain('task');
});

test('the model proposal contains candidates rather than provider identities or evidence claims', () => {
  const proposal = explicitModelProposal();
  const serialized = JSON.stringify(proposal);

  expect(aiPlannerModelProposalSchema.safeParse(proposal).success).toBe(true);
  expect(serialized).not.toContain('providerPlaceId');
  expect(serialized).not.toContain('openingHours');
  expect(serialized).not.toContain('latitude');
  expect(serialized).not.toContain('longitude');
});

test('review drafts distinguish verified Places, Custom Places, unchecked evidence, and warnings', () => {
  const draft = customPlaceDraft();
  draft.places.push({
    id: 'place:custom-unverified',
    name: 'Unresolved cafe recommendation',
    note: null,
    resolution: 'custom',
    verification: 'unverified',
  });
  draft.warnings.push({
    code: 'hard_constraint_conflict',
    evidenceIds: [],
    id: 'warning:material',
    itemIds: [],
    material: true,
  });
  const result = aiPlannerDraftSchema.parse(draft);

  expect(result.places).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ resolution: 'verified' }),
      expect.objectContaining({ resolution: 'custom', verification: 'not_checked' }),
      expect.objectContaining({ resolution: 'custom', verification: 'unverified' }),
    ]),
  );
  expect(result.evidence).toContainEqual(
    expect.objectContaining({ checkedAt: null, provider: null, status: 'not_checked' }),
  );
  expect(result.unscheduledItems).toContainEqual(expect.objectContaining({ id: 'item:custom' }));
  expect(result.warnings).toContainEqual(
    expect.objectContaining({ code: 'custom_place_not_checked', material: false }),
  );
  expect(result.warnings).toContainEqual(expect.objectContaining({ material: true }));
});

test('verified draft places require explicit Google provenance and attribution shape', () => {
  const draft = explicitDraft();
  const verified = draft.places.find((place) => place.resolution === 'verified');
  expect(verified).toMatchObject({ attributions: [], provider: 'google' });

  if (!verified || verified.resolution !== 'verified') throw new Error('verified fixture missing');
  const missingProvider = { ...verified } as Record<string, unknown>;
  delete missingProvider.provider;
  draft.places[0] = missingProvider as (typeof draft.places)[number];
  expect(aiPlannerDraftSchema.safeParse(draft).success).toBe(false);
});

test('malformed model output is rejected without coercion', () => {
  const proposal = explicitModelProposal() as unknown as Record<string, unknown>;
  proposal.items = [{ label: 'unsupported partial item' }];

  const result = parseAiPlannerModelProposal(proposal);

  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected malformed proposal to fail.');
  expect(result.issues.every((issue) => issue.code === 'invalid_contract')).toBe(true);
});

test('the model must write a trip description, and the draft keeps it beside the name', () => {
  const proposal = explicitModelProposal() as unknown as Record<string, unknown>;
  delete proposal.tripDescription;

  expect(parseAiPlannerModelProposal(proposal).success).toBe(false);
  expect(parseAiPlannerDraft(explicitDraft())).toMatchObject({
    data: { trip: { description: expect.any(String) } },
    success: true,
  });
});

/**
 * Every stored draft is re-parsed on read, so a draft written before the model
 * wrote descriptions has to survive the field arriving. Without the default it
 * would fail the strict schema and take its whole session down with it.
 */
test('a draft stored before descriptions existed still parses, with a null description', () => {
  const draft = explicitDraft() as unknown as { trip: Record<string, unknown> };
  delete draft.trip.description;

  const result = parseAiPlannerDraft(draft);

  expect(result.success).toBe(true);
  if (!result.success) throw new Error('Expected a pre-description draft to parse.');
  expect(result.data.trip.description).toBeNull();
});
