import { expect, test } from 'vitest';

import {
  composeAiPlanningBrief,
  fixedAiPlanningBriefMatcher,
  splitAiPlanningBrief,
  templateAiPlanningBriefMatcher,
  type AiPlanningBriefSelection,
} from '../lib/ai-planning/brief.ts';

const couple: AiPlanningBriefSelection = {
  key: 'who',
  label: 'Two of us',
  option: 'couple',
  sentence: 'There are two of us.',
};
const slow: AiPlanningBriefSelection = {
  key: 'pace',
  label: 'Slow',
  option: 'slow',
  sentence: "We'd like a slow pace.",
};
const mustSee = templateAiPlanningBriefMatcher('Must see {places}.', ({ places = '' }) => ({
  key: 'mustSee',
  label: places,
  option: 'written',
  sentence: `Must see ${places}.`,
}));
const matchers = [fixedAiPlanningBriefMatcher(couple), fixedAiPlanningBriefMatcher(slow), mustSee];

test('choices travel with the brief without touching the traveller’s own words', () => {
  expect(composeAiPlanningBrief('  Kyoto in autumn  ', [couple, slow])).toBe(
    "Kyoto in autumn\n\nThere are two of us. We'd like a slow pace.",
  );
  expect(composeAiPlanningBrief('', [couple])).toBe('There are two of us.');
  expect(composeAiPlanningBrief('Kyoto in autumn', [])).toBe('Kyoto in autumn');
});

test('a composed brief comes back as the same words and choices', () => {
  const sent = composeAiPlanningBrief('Kyoto in autumn.\n\nLots of food.', [
    couple,
    {
      key: 'mustSee',
      label: 'Fushimi Inari',
      option: 'written',
      sentence: 'Must see Fushimi Inari.',
    },
  ]);
  expect(splitAiPlanningBrief(sent, matchers)).toStrictEqual({
    selections: [
      couple,
      {
        key: 'mustSee',
        label: 'Fushimi Inari',
        option: 'written',
        sentence: 'Must see Fushimi Inari.',
      },
    ],
    text: 'Kyoto in autumn.\n\nLots of food.',
  });
  expect(splitAiPlanningBrief('There are two of us.', matchers)).toStrictEqual({
    selections: [couple],
    text: '',
  });
});

test('a closing paragraph that is not all choices stays as the traveller’s text', () => {
  const typed = "Kyoto in autumn.\n\nThere are two of us. We'll decide the rest later.";
  expect(splitAiPlanningBrief(typed, matchers)).toStrictEqual({ selections: [], text: typed });
  expect(splitAiPlanningBrief('There are two of us and a dog.', matchers).selections).toEqual([]);
});
