import assert from 'node:assert/strict';
import { test } from 'vitest';

import { isPlanScoreDisabled } from '../lib/plan-score/feature-flag.ts';

test('recognizes the Plan Score kill switch without exposing it to browser code', () => {
  assert.equal(isPlanScoreDisabled({}), false);
  assert.equal(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: '1' }), true);
  assert.equal(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: ' TRUE ' }), true);
  assert.equal(isPlanScoreDisabled({ TROVE_PLAN_SCORE_DISABLED: 'false' }), false);
});
