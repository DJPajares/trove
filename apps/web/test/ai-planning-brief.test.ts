import { expect, test } from 'vitest';

import {
  aiPlanningBriefDayCount,
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

test('a counted group and a named stay come back with their values', () => {
  const friends = templateAiPlanningBriefMatcher("We're {count} friends.", ({ count = '' }) => ({
    key: 'who',
    label: `${count} friends`,
    option: 'friends',
    sentence: `We're ${count} friends.`,
  }));
  const stay = templateAiPlanningBriefMatcher("We're staying at {stay}.", ({ stay = '' }) => ({
    key: 'stay',
    label: stay,
    option: 'named',
    sentence: `We're staying at ${stay}.`,
  }));
  const sent = "Lisbon for a long weekend.\n\nWe're 5 friends. We're staying at Casa do Bairro.";
  expect(splitAiPlanningBrief(sent, [friends, stay])).toStrictEqual({
    selections: [
      { key: 'who', label: '5 friends', option: 'friends', sentence: "We're 5 friends." },
      {
        key: 'stay',
        label: 'Casa do Bairro',
        option: 'named',
        sentence: "We're staying at Casa do Bairro.",
      },
    ],
    text: 'Lisbon for a long weekend.',
  });
});

test('a date range counts its days inclusively, and nothing when incomplete or reversed', () => {
  expect(aiPlanningBriefDayCount('2026-12-01', '2026-12-01')).toBe(1);
  expect(aiPlanningBriefDayCount('2026-12-01', '2026-12-10')).toBe(10);
  expect(aiPlanningBriefDayCount('2026-12-01', '2026-12-15')).toBe(15);
  expect(aiPlanningBriefDayCount('2026-12-10', '2026-12-01')).toBe(0);
  expect(aiPlanningBriefDayCount('', '2026-12-01')).toBe(0);
});
