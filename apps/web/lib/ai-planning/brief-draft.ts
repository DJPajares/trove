/**
 * The brief a traveller is writing, kept on this device until it is used,
 * cleared or they sign out. A phone that backgrounds the app can reload the
 * page on return; without this, closing the drawer to check something else
 * could quietly cost the traveller everything they had written.
 *
 * It stores the composed brief - their words and the sentences their choices
 * carry - so it is turned back into words and chips in the current language on
 * the way in. Local only; nothing here is sent anywhere.
 */
export const AI_PLANNING_BRIEF_DRAFT_KEY = 'trove:ai-planning-brief:v1';

/** As long as a planning session lives, so a kept brief never outlasts one. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type DraftStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function storage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAiPlanningBriefDraft(
  store: DraftStorage | null = storage(),
  now = Date.now(),
): string | null {
  try {
    const value: unknown = JSON.parse(store?.getItem(AI_PLANNING_BRIEF_DRAFT_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { prompt, savedAt } = value as { prompt?: unknown; savedAt?: unknown };
    if (typeof prompt !== 'string' || !prompt.trim() || typeof savedAt !== 'number') return null;
    if (now - savedAt > DRAFT_MAX_AGE_MS) {
      store?.removeItem(AI_PLANNING_BRIEF_DRAFT_KEY);
      return null;
    }
    return prompt;
  } catch {
    return null;
  }
}

export function writeAiPlanningBriefDraft(
  prompt: string,
  store: DraftStorage | null = storage(),
  now = Date.now(),
) {
  try {
    if (prompt.trim()) {
      store?.setItem(AI_PLANNING_BRIEF_DRAFT_KEY, JSON.stringify({ prompt, savedAt: now }));
    } else {
      store?.removeItem(AI_PLANNING_BRIEF_DRAFT_KEY);
    }
  } catch {
    // A full or blocked store only means the draft lasts as long as the page.
  }
}

export function clearAiPlanningBriefDraft(store: DraftStorage | null = storage()) {
  try {
    store?.removeItem(AI_PLANNING_BRIEF_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
