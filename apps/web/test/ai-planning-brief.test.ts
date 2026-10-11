import { expect, test } from 'vitest';

import { appendToAiPlanningBrief } from '../lib/ai-planning/brief.ts';
import { AI_PLANNING_PROMPT_MAX_LENGTH } from '../lib/ai-planning/presentation.ts';

test('an added sentence closes the one before it and never doubles punctuation', () => {
  expect(appendToAiPlanningBrief('', 'Two of us.')).toBe('Two of us.');
  expect(appendToAiPlanningBrief('Kyoto in autumn', 'Two of us.')).toBe(
    'Kyoto in autumn. Two of us.',
  );
  expect(appendToAiPlanningBrief('Kyoto in autumn!  ', 'Two of us.')).toBe(
    'Kyoto in autumn! Two of us.',
  );
});

test('a sentence starter leaves room to keep typing', () => {
  expect(appendToAiPlanningBrief('Kyoto, two of us.', 'Must see', { open: true })).toBe(
    'Kyoto, two of us. Must see ',
  );
});

test('a tap never truncates or pads the brief', () => {
  const full = 'x'.repeat(AI_PLANNING_PROMPT_MAX_LENGTH - 3);
  expect(appendToAiPlanningBrief(full, 'Two of us.')).toBeNull();
  expect(appendToAiPlanningBrief('Kyoto.', '   ')).toBeNull();
});
