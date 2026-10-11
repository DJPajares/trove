import type { TrovePlaceCategory } from '@/lib/place-categories';

export const aiPlanningExampleSets = {
  foodAndNature: ['tokyoFood', 'costaRicaOutdoors', 'singaporeWork'],
  sharedAdventures: ['lisbonBudget', 'scottishRoadTrip', 'barcelonaFamily'],
  differentPaces: ['romePacked', 'icelandPhotography', 'beachEscape'],
  activeExploration: ['bangkokFood', 'queenstownAdventure', 'vietnamFriends'],
} as const;

type ExampleSetId = keyof typeof aiPlanningExampleSets;
export type AiPlanningExampleId = (typeof aiPlanningExampleSets)[ExampleSetId][number];

/**
 * The tint and glyph each idea card borrows from the place-category fallbacks.
 * Decorative and local: an idea card never fetches a photograph, so browsing
 * ideas stays free of provider requests.
 */
export const aiPlanningExampleCategories: Record<AiPlanningExampleId, TrovePlaceCategory> = {
  bangkokFood: 'food_and_drink',
  barcelonaFamily: 'things_to_do',
  beachEscape: 'stay',
  costaRicaOutdoors: 'things_to_do',
  icelandPhotography: 'destination',
  lisbonBudget: 'destination',
  queenstownAdventure: 'things_to_do',
  romePacked: 'things_to_do',
  scottishRoadTrip: 'transport',
  singaporeWork: 'destination',
  tokyoFood: 'food_and_drink',
  vietnamFriends: 'destination',
};

export const AI_PLANNING_EXAMPLES_STORAGE_KEY = 'trove:ai-planning-examples:v1';
const setIds = Object.keys(aiPlanningExampleSets) as ExampleSetId[];

type RotationState = { remaining: ExampleSetId[]; last: ExampleSetId };
type RotationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isSetId(value: unknown): value is ExampleSetId {
  return typeof value === 'string' && Object.hasOwn(aiPlanningExampleSets, value);
}

function readState(storage: RotationStorage | undefined): RotationState | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(AI_PLANNING_EXAMPLES_STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object' || !('last' in value) || !('remaining' in value)) {
      return null;
    }
    const { last, remaining } = value;
    if (
      !isSetId(last) ||
      !Array.isArray(remaining) ||
      !remaining.every(isSetId) ||
      remaining.length >= setIds.length ||
      new Set(remaining).size !== remaining.length ||
      remaining.includes(last)
    ) {
      return null;
    }
    return { last, remaining };
  } catch {
    return null;
  }
}

/** Local inspiration only: the queue contains catalogue IDs, never traveller data. */
export function createAiPlanningExampleRotation({
  getStorage = () => window.localStorage,
  random = Math.random,
}: {
  getStorage?: () => RotationStorage;
  random?: () => number;
} = {}) {
  let initialized = false;
  let state: RotationState | null = null;
  let storage: RotationStorage | undefined;

  return {
    next(): readonly AiPlanningExampleId[] {
      if (!initialized) {
        initialized = true;
        try {
          storage = getStorage();
        } catch {
          // Restricted storage still permits rotation for this browser session.
        }
        state = readState(storage);
      }

      const remaining = state?.remaining.slice() ?? [];
      if (remaining.length === 0) {
        remaining.push(...setIds);
        for (let index = remaining.length - 1; index > 0; index -= 1) {
          const other = Math.floor(random() * (index + 1));
          [remaining[index], remaining[other]] = [remaining[other]!, remaining[index]!];
        }
        if (remaining[0] === state?.last) {
          [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
        }
      }

      const last = remaining.shift()!;
      state = { last, remaining };
      try {
        storage?.setItem(AI_PLANNING_EXAMPLES_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Keep the in-memory queue when persistence is unavailable or full.
      }
      return aiPlanningExampleSets[last];
    },
  };
}

// Storage is accessed only by next(), after the composer mounts in the browser.
export const aiPlanningExampleRotation = createAiPlanningExampleRotation();
