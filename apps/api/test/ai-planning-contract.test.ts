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

test('malformed model output is rejected without coercion', () => {
  const proposal = explicitModelProposal() as unknown as Record<string, unknown>;
  proposal.items = [{ label: 'unsupported partial item' }];

  const result = parseAiPlannerModelProposal(proposal);

  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected malformed proposal to fail.');
  expect(result.issues.every((issue) => issue.code === 'invalid_contract')).toBe(true);
});
