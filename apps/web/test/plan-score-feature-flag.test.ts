import { expect, test } from 'vitest';

import { isPlanScoreDisabled } from '../lib/plan-score/feature-flag.ts';

test('recognizes the Plan Score kill switch without exposing it to browser code', () => {
  expect(isPlanScoreDisabled({})).toBe(false);
  expect(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: '1' })).toBe(true);
  expect(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: ' TRUE ' })).toBe(true);
  expect(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: 'false' })).toBe(false);
});
