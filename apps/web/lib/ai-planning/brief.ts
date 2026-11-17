/**
 * The brief is still one free-form prompt (PRD 7.6.1). Ingredients and quick
 * changes are choices the traveller turns on beside their own words: each one
 * carries a plain sentence that travels with the brief when it is sent, so the
 * text box stays exactly what they typed and every choice can be switched off.
 */
export const aiPlanningBriefPicks = {
  when: ['thisWeekend', 'nextMonth', 'flexibleShort', 'flexibleWeek'],
  who: ['solo', 'couple', 'family', 'friends'],
  // The planner's own three densities (PRD 7.6): 2-3, 3-4 and 5-6 stops a day.
  pace: ['relaxed', 'balanced', 'packed'],
  stay: ['noHotels'],
  rhythm: ['early', 'late', 'evenings'],
} as const;

export type AiPlanningBriefPickIngredient = keyof typeof aiPlanningBriefPicks;

/**
 * Who's coming options that carry a head count, so the planner reads a party
 * size rather than falling back to one traveller.
 */
export const aiPlanningBriefGroups = ['family', 'friends'] as const;
export type AiPlanningBriefGroup = (typeof aiPlanningBriefGroups)[number];
export const AI_PLANNING_GROUP_MIN = 2;
export const AI_PLANNING_GROUP_MAX = 20;
export const aiPlanningGroupDefault: Record<AiPlanningBriefGroup, number> = {
  family: 4,
  friends: 4,
};

/** Chip order. `mustSee` is the one the traveller answers in their own words. */
export const aiPlanningBriefIngredients = [
  'when',
  'who',
  'pace',
  'mustSee',
  'stay',
  'rhythm',
] as const;

export type AiPlanningBriefIngredient = (typeof aiPlanningBriefIngredients)[number];

/** The ingredients a first brief shows up front; the rest wait behind "More". */
export const aiPlanningBriefPrimaryIngredients: readonly AiPlanningBriefIngredient[] = [
  'when',
  'who',
  'pace',
];

/**
 * Turning saved finds off is a choice like any other, sent as a sentence, but
 * it lives on its own switch rather than a chip.
 */
export const AI_PLANNING_FINDS_KEY = 'finds';

/** Inclusive days from one ISO date to another, or 0 when the range is incomplete or reversed. */
export function aiPlanningBriefDayCount(start: string, end: string) {
  if (!start || !end || end < start) return 0;
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
}

/** What a regenerate most often asks for, each one a sentence beside the brief. */
export const aiPlanningBriefNudges = [
  'moreFood',
  'slower',
  'freeAfternoon',
  'fewerSights',
  'shorter',
] as const;

/** One choice the traveller turned on: the chip shows `label`, the planner reads `sentence`. */
export type AiPlanningBriefSelection = {
  key: string;
  label: string;
  option: string;
  sentence: string;
};

/**
 * What is sent: the traveller's own words, then their choices as one closing
 * paragraph. Either half may be empty.
 */
export function composeAiPlanningBrief(
  text: string,
  selections: readonly AiPlanningBriefSelection[],
) {
  const added = selections
    .map((selection) => selection.sentence.trim())
    .filter(Boolean)
    .join(' ');
  return [text.trim(), added].filter(Boolean).join('\n\n');
}

/** Recognises one choice's sentence at the start of the text that remains. */
export type AiPlanningBriefMatcher = (
  remaining: string,
) => { length: number; selection: AiPlanningBriefSelection } | null;

const endsSentence = (remaining: string, length: number) =>
  remaining.length === length || /\s/u.test(remaining.charAt(length));

export function fixedAiPlanningBriefMatcher(
  selection: AiPlanningBriefSelection,
): AiPlanningBriefMatcher {
  return (remaining) =>
    remaining.startsWith(selection.sentence) && endsSentence(remaining, selection.sentence.length)
      ? { length: selection.sentence.length, selection }
      : null;
}

/** For a sentence with values in it, written as a message template ("Must see {places}."). */
export function templateAiPlanningBriefMatcher(
  template: string,
  build: (values: Record<string, string>) => AiPlanningBriefSelection,
): AiPlanningBriefMatcher {
  const names: string[] = [];
  const source = template
    .split(/(\{\w+\})/u)
    .map((part) => {
      const name = /^\{(\w+)\}$/u.exec(part)?.[1];
      if (name) {
        names.push(name);
        return '(.+?)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    })
    .join('');
  const pattern = new RegExp(`^${source}(?=\\s|$)`, 'u');
  return (remaining) => {
    const match = pattern.exec(remaining);
    if (!match) return null;
    const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? '']));
    return { length: match[0].length, selection: build(values) };
  };
}

/**
 * Turns a brief Trove composed earlier back into words and choices, so a
 * traveller returning to it sees their chips rather than sentences they never
 * typed. Only a closing paragraph made entirely of known choices is peeled
 * off; anything else stays as the traveller's own text, so a brief that does
 * not match can never lose a word.
 */
export function splitAiPlanningBrief(
  prompt: string,
  matchers: readonly AiPlanningBriefMatcher[],
): { selections: AiPlanningBriefSelection[]; text: string } {
  const trimmed = prompt.trim();
  const breakAt = trimmed.lastIndexOf('\n\n');
  let remaining = (breakAt === -1 ? trimmed : trimmed.slice(breakAt + 2)).trim();
  const selections: AiPlanningBriefSelection[] = [];
  while (remaining) {
    const found = matchers.map((matcher) => matcher(remaining)).find(Boolean);
    if (!found) return { selections: [], text: prompt };
    selections.push(found.selection);
    remaining = remaining.slice(found.length).trimStart();
  }
  return { selections, text: breakAt === -1 ? '' : trimmed.slice(0, breakAt) };
}
