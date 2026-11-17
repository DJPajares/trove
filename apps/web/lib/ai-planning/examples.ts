import type { TrovePlaceCategory } from '@/lib/place-categories';

export const aiPlanningExampleSets = {
  foodAndNature: ['tokyoSlow', 'baliRetreat', 'bangkokFood'],
  sharedAdventures: ['barcelonaFamily', 'hanoiFriends', 'kyotoCouple'],
  differentPaces: ['romePacked', 'parisSlow', 'istanbulWeekend'],
  activeExploration: ['queenstownOutdoors', 'lisbonViews', 'singaporeEvenings'],
} as const;

type ExampleSetId = keyof typeof aiPlanningExampleSets;
export type AiPlanningExampleId = (typeof aiPlanningExampleSets)[ExampleSetId][number];

/**
 * The tint and glyph each idea card borrows from the place categories.
 * Decorative and local: an idea card never fetches a photograph, so browsing
 * ideas stays free of provider requests.
 */
export const aiPlanningExampleCategories: Record<AiPlanningExampleId, TrovePlaceCategory> = {
  baliRetreat: 'stay',
  bangkokFood: 'food_and_drink',
  barcelonaFamily: 'things_to_do',
  hanoiFriends: 'food_and_drink',
  istanbulWeekend: 'shopping',
  kyotoCouple: 'destination',
  lisbonViews: 'destination',
  parisSlow: 'food_and_drink',
  queenstownOutdoors: 'things_to_do',
  romePacked: 'things_to_do',
  singaporeEvenings: 'food_and_drink',
  tokyoSlow: 'destination',
};

/**
 * The brief options an idea turns on beside its words, so a traveller starts
 * from the same chips they would have picked: who's coming, how full the days
 * are, roughly when, and any daily rhythm. Must-sees are words, kept with the
 * idea's messages. Every value here is one the planner reads (PRD 7.6).
 */
export type AiPlanningExamplePicks = {
  pace: 'balanced' | 'packed' | 'relaxed';
  rhythm?: 'early' | 'evenings' | 'late';
  when: 'flexibleShort' | 'flexibleWeek' | 'nextMonth' | 'thisWeekend';
  who: 'couple' | 'solo' | { count: number; group: 'family' | 'friends' };
};

export const aiPlanningExamplePicks: Record<AiPlanningExampleId, AiPlanningExamplePicks> = {
  baliRetreat: { pace: 'relaxed', when: 'flexibleWeek', who: 'couple' },
  bangkokFood: { pace: 'balanced', when: 'flexibleShort', who: { count: 3, group: 'friends' } },
  barcelonaFamily: { pace: 'relaxed', when: 'flexibleShort', who: { count: 4, group: 'family' } },
  hanoiFriends: { pace: 'balanced', when: 'flexibleWeek', who: { count: 6, group: 'friends' } },
  istanbulWeekend: { pace: 'balanced', when: 'thisWeekend', who: 'solo' },
  kyotoCouple: { pace: 'relaxed', rhythm: 'early', when: 'flexibleShort', who: 'couple' },
  lisbonViews: { pace: 'relaxed', rhythm: 'late', when: 'nextMonth', who: 'couple' },
  parisSlow: { pace: 'relaxed', rhythm: 'late', when: 'flexibleShort', who: 'couple' },
  queenstownOutdoors: { pace: 'packed', when: 'flexibleShort', who: 'solo' },
  romePacked: { pace: 'packed', rhythm: 'early', when: 'flexibleShort', who: 'couple' },
  singaporeEvenings: { pace: 'balanced', when: 'flexibleWeek', who: 'solo' },
  tokyoSlow: { pace: 'balanced', when: 'flexibleShort', who: 'solo' },
};

export const AI_PLANNING_EXAMPLES_STORAGE_KEY = 'trove:ai-planning-examples:v2';
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

  let shown: readonly AiPlanningExampleId[] | null = null;

  return {
    /**
     * The ideas for this visit: rotated once when the page loads, then the same
     * set every time the drawer reopens, so closing it to check something never
     * swaps the ideas a traveller was looking at.
     */
    forVisit(): readonly AiPlanningExampleId[] {
      shown ??= this.next();
      return shown;
    },
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
      shown = aiPlanningExampleSets[last];
      return shown;
    },
  };
}

// Storage is accessed only by next(), after the composer mounts in the browser.
export const aiPlanningExampleRotation = createAiPlanningExampleRotation();
