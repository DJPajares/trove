import { AI_PLANNING_PROMPT_MAX_LENGTH } from './presentation';

/**
 * The brief is still one free-form prompt (PRD 7.6.1). Ingredients and quick
 * changes only help the traveller write it: each one adds a plain sentence they
 * can read, edit or undo, so nothing reaches the planner that is not in their
 * own text.
 */
export const aiPlanningBriefPicks = {
  when: ['thisWeekend', 'nextMonth', 'flexibleShort', 'flexibleWeek'],
  who: ['solo', 'couple', 'family', 'friends'],
  pace: ['slow', 'balanced', 'full', 'early'],
} as const;

export type AiPlanningBriefTray = keyof typeof aiPlanningBriefPicks;

/** Ingredients without a tray start a sentence and leave the caret at its end. */
export const aiPlanningBriefStarters = ['mustSee', 'work', 'travel'] as const;

/** What a regenerate most often asks for, each one sentence appended to the brief. */
export const aiPlanningBriefNudges = [
  'moreFood',
  'slower',
  'freeAfternoon',
  'fewerSights',
  'shorter',
] as const;

/**
 * Adds one sentence to the end of a brief. A finished sentence is closed before
 * the next begins; an `open` addition keeps a trailing space so typing carries
 * on from it. Returns null when the result would exceed the prompt limit, so a
 * tap can never silently truncate what the traveller wrote.
 */
export function appendToAiPlanningBrief(
  brief: string,
  addition: string,
  { open = false }: { open?: boolean } = {},
): string | null {
  const base = brief.trimEnd();
  const text = addition.trim();
  if (!text) return null;
  const separator = !base ? '' : /[.!?…。！？]$/u.test(base) ? ' ' : '. ';
  const next = `${base}${separator}${text}${open ? ' ' : ''}`;
  return next.length > AI_PLANNING_PROMPT_MAX_LENGTH ? null : next;
}
