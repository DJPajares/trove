import { expect, test } from 'vitest';

import {
  AI_PLANNING_BRIEF_DRAFT_KEY,
  clearAiPlanningBriefDraft,
  readAiPlanningBriefDraft,
  writeAiPlanningBriefDraft,
} from '../lib/ai-planning/brief-draft.ts';
import { createAiPlanningExampleRotation } from '../lib/ai-planning/examples.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

test('a written brief comes back after the drawer closes or the page reloads', () => {
  const store = memoryStorage();
  writeAiPlanningBriefDraft("Kyoto's temples.\n\nThere are two of us.", store, 1_000);
  expect(readAiPlanningBriefDraft(store, 2_000)).toBe("Kyoto's temples.\n\nThere are two of us.");
});

test('an emptied, cleared or week-old brief is not brought back', () => {
  const store = memoryStorage();
  writeAiPlanningBriefDraft('Lisbon', store, 0);
  writeAiPlanningBriefDraft('   ', store, 0);
  expect(readAiPlanningBriefDraft(store, 0)).toBeNull();

  writeAiPlanningBriefDraft('Lisbon', store, 0);
  clearAiPlanningBriefDraft(store);
  expect(readAiPlanningBriefDraft(store, 0)).toBeNull();

  writeAiPlanningBriefDraft('Lisbon', store, 0);
  expect(readAiPlanningBriefDraft(store, 8 * 24 * 60 * 60 * 1000)).toBeNull();
  expect(store.getItem(AI_PLANNING_BRIEF_DRAFT_KEY)).toBeNull();
});

test('a broken kept draft is ignored rather than thrown', () => {
  const store = memoryStorage();
  store.setItem(AI_PLANNING_BRIEF_DRAFT_KEY, '{not json');
  expect(readAiPlanningBriefDraft(store)).toBeNull();
});

test('reopening the drawer in the same visit shows the same ideas', () => {
  const rotation = createAiPlanningExampleRotation({
    getStorage: () => ({ getItem: () => null, setItem: () => undefined }),
    random: () => 0,
  });
  const first = rotation.forVisit();
  expect(rotation.forVisit()).toBe(first);
  expect(rotation.forVisit()).toBe(first);
});
