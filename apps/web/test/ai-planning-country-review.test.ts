import { expect, test, vi } from 'vitest';

import type { AiPlanningDraft, AiPlanningSession } from '../lib/ai-planning/api.ts';
import {
  aiPlanningCountrySaveIsCurrent,
  prepareAiPlanningCountriesForApply,
} from '../lib/ai-planning/review.ts';

function session(): AiPlanningSession {
  return {
    appliedTripId: null,
    countryContextChanged: false,
    countriesReviewedRevision: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    deadlineAt: null,
    draft: { warnings: [] } as unknown as AiPlanningDraft,
    draftRevision: 2,
    expiresAt: '2026-10-01T00:00:00.000Z',
    id: 'session:country-review',
    lastSafeError: null,
    pendingRunId: null,
    planScore: null,
    prompt: 'Vietnam',
    reviewedCountries: [],
    schemaVersion: 1,
    stage: 'reviewing',
    status: 'reviewing',
    suggestedCountries: ['VN'],
    tripDescription: null,
    tripName: null,
    updatedAt: '2026-09-01T00:00:00.000Z',
    warningAcknowledgement: null,
  };
}

test('a response for an earlier rapid edit cannot replace the latest visible selection', () => {
  const current = session();
  expect(aiPlanningCountrySaveIsCurrent(current, current, ['VN'], ['VN', 'SG'])).toBe(false);
  expect(aiPlanningCountrySaveIsCurrent(current, current, ['VN', 'SG'], ['VN', 'SG'])).toBe(true);
  expect(
    aiPlanningCountrySaveIsCurrent(current, { ...current, draftRevision: 3 }, ['VN'], ['VN']),
  ).toBe(false);
  expect(
    aiPlanningCountrySaveIsCurrent(current, { ...current, status: 'generating' }, ['VN'], ['VN']),
  ).toBe(false);
});

test('Apply saves untouched suggestions, then reuses approval for the same revision', async () => {
  const current = session();
  const reviewed = { ...current, countriesReviewedRevision: 2, reviewedCountries: ['VN'] };
  const save = vi.fn().mockResolvedValue(reviewed);
  expect(await prepareAiPlanningCountriesForApply(current, ['VN'], save)).toEqual(reviewed);
  expect(save).toHaveBeenCalledWith(current, ['VN']);
  await prepareAiPlanningCountriesForApply(reviewed, ['VN'], save);
  expect(save).toHaveBeenCalledTimes(1);
});

test('empty countries and failed saves stop Apply without changing the current draft', async () => {
  const current = session();
  const save = vi.fn().mockResolvedValue(null);
  expect(await prepareAiPlanningCountriesForApply(current, [], save)).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(await prepareAiPlanningCountriesForApply(current, ['VN'], save)).toBeNull();
  expect(current.countriesReviewedRevision).toBeNull();
  expect(current.draft).not.toBeNull();
  save.mockResolvedValue({ ...current, countriesReviewedRevision: 2, reviewedCountries: ['VN'] });
  expect(await prepareAiPlanningCountriesForApply(current, ['VN'], save)).not.toBeNull();
});

test('a timezone change discovered during the country save does not hold back Apply', async () => {
  const current = session();
  const reviewed = {
    ...current,
    countriesReviewedRevision: 2,
    countryContextChanged: true,
    reviewedCountries: ['VN'],
  };
  const save = vi.fn().mockResolvedValue(reviewed);
  expect(await prepareAiPlanningCountriesForApply(current, ['VN'], save)).toEqual(reviewed);
});
