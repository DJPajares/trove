import { expect, test, vi } from 'vitest';

import {
  AI_PLANNING_EXAMPLES_STORAGE_KEY,
  aiPlanningExampleSets,
  createAiPlanningExampleRotation,
} from '../lib/ai-planning/examples.ts';
import { isAiPlanningPromptValid } from '../lib/ai-planning/presentation.ts';
import messages from '../messages/en.json';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn((_key: string) => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

test('every cycle shows all twelve localized, usable examples before repeating', () => {
  const storage = memoryStorage();
  const rotation = createAiPlanningExampleRotation({ getStorage: () => storage, random: () => 0 });
  const firstCycle = Array.from({ length: 4 }, () => rotation.next());
  expect(firstCycle.every((set) => set.length === 3)).toBe(true);
  expect(new Set(firstCycle.flat()).size).toBe(12);
  expect(rotation.next()).not.toEqual(firstCycle[3]);

  for (const id of firstCycle.flat()) {
    expect(messages.trips.aiPlanning.exampleLabels[id].trim()).not.toBe('');
    expect(isAiPlanningPromptValid(messages.trips.aiPlanning.examples[id])).toBe(true);
  }
  expect(Object.keys(messages.trips.aiPlanning.examples)).toHaveLength(12);
});

test('a new cycle never starts with the set that ended the last cycle', () => {
  const storage = memoryStorage(JSON.stringify({ last: 'foodAndNature', remaining: [] }));
  const rotation = createAiPlanningExampleRotation({
    getStorage: () => storage,
    random: () => 0.999,
  });
  expect(rotation.next()).not.toEqual(aiPlanningExampleSets.foodAndNature);
  const cycle = JSON.parse(storage.getItem(AI_PLANNING_EXAMPLES_STORAGE_KEY)!);
  expect(new Set([cycle.last, ...cycle.remaining]).size).toBe(4);
});

test('reopening after a reload continues the persisted queue without exposing traveller data', () => {
  const storage = memoryStorage();
  const random = vi.fn(() => 0);
  const first = createAiPlanningExampleRotation({ getStorage: () => storage, random });
  const shown = first.next();
  const persisted = JSON.parse(storage.getItem(AI_PLANNING_EXAMPLES_STORAGE_KEY)!);
  expect(Object.keys(persisted).sort()).toEqual(['last', 'remaining']);
  expect(storage.setItem).toHaveBeenCalledWith(
    AI_PLANNING_EXAMPLES_STORAGE_KEY,
    JSON.stringify(persisted),
  );

  random.mockClear();
  const reopened = createAiPlanningExampleRotation({ getStorage: () => storage, random });
  expect(reopened.next()).toEqual(
    aiPlanningExampleSets[persisted.remaining[0] as keyof typeof aiPlanningExampleSets],
  );
  expect(reopened.next()).not.toEqual(shown);
  expect(random).not.toHaveBeenCalled();
});

test.each([
  '{broken',
  'null',
  '[]',
  JSON.stringify({ last: 'unknown', remaining: [] }),
  JSON.stringify({ last: 'foodAndNature', remaining: ['unknown'] }),
  JSON.stringify({ last: 'foodAndNature', remaining: ['foodAndNature'] }),
  JSON.stringify({ last: 'foodAndNature', remaining: ['sharedAdventures', 'sharedAdventures'] }),
  JSON.stringify({ last: 'foodAndNature', remaining: 'sharedAdventures' }),
])('invalid storage %s falls back to a complete in-memory cycle', (invalid) => {
  const storage = memoryStorage(invalid);
  const rotation = createAiPlanningExampleRotation({ getStorage: () => storage, random: () => 0 });
  expect(new Set(Array.from({ length: 4 }, () => rotation.next()).flat()).size).toBe(12);
});

test('storage is acquired once and only when examples are requested in the browser', () => {
  const getStorage = vi.fn(() => memoryStorage());
  const rotation = createAiPlanningExampleRotation({ getStorage });
  expect(getStorage).not.toHaveBeenCalled();
  rotation.next();
  rotation.next();
  expect(getStorage).toHaveBeenCalledTimes(1);
});

test('browsing examples is entirely local and makes no acquisition or generation requests', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    const rotation = createAiPlanningExampleRotation({ getStorage: () => memoryStorage() });
    for (let index = 0; index < 8; index += 1) rotation.next();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each(['acquire', 'read', 'write'])(
  'a storage %s failure still rotates without repeats',
  (phase) => {
    const storage = memoryStorage();
    const fail = () => {
      throw new Error('Storage unavailable');
    };
    if (phase === 'read') storage.getItem.mockImplementation(fail);
    if (phase === 'write') storage.setItem.mockImplementation(fail);
    const rotation = createAiPlanningExampleRotation({
      getStorage: phase === 'acquire' ? fail : () => storage,
      random: () => 0,
    });
    expect(new Set(Array.from({ length: 4 }, () => rotation.next()).flat()).size).toBe(12);
  },
);
