import { expect, test } from 'vitest';

import {
  AI_PLANNING_PROMPT_MAX_LENGTH,
  aiPlanningErrorMessageKey,
  isAiPlanningPromptValid,
  isAiPlanningSessionGenerating,
} from '../lib/ai-planning/presentation.ts';

test('AI prompts are trimmed and bounded before a generation can start', () => {
  expect(isAiPlanningPromptValid('Tokyo for a food-focused weekend')).toBe(true);
  expect(isAiPlanningPromptValid('   ')).toBe(false);
  expect(isAiPlanningPromptValid('x'.repeat(AI_PLANNING_PROMPT_MAX_LENGTH + 1))).toBe(false);
});

test('only active lifecycle states are polled for progress', () => {
  expect(isAiPlanningSessionGenerating('pending')).toBe(true);
  expect(isAiPlanningSessionGenerating('generating')).toBe(true);
  expect(isAiPlanningSessionGenerating('reviewing')).toBe(false);
  expect(isAiPlanningSessionGenerating('failed')).toBe(false);
});

test('unexpected server codes never become user-facing API details', () => {
  expect(aiPlanningErrorMessageKey('timeout')).toBe('timeout');
  expect(aiPlanningErrorMessageKey('provider_unavailable')).toBe('provider_unavailable');
  expect(aiPlanningErrorMessageKey('sensitive_provider_error')).toBe('request_failed');
});
