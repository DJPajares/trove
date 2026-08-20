import assert from 'node:assert/strict';
import { test } from 'vitest';

import { activityDensityForItemCount } from '../lib/activity-density.ts';

test('maps itinerary item counts to activity-density thresholds', () => {
  assert.equal(activityDensityForItemCount(0), null);
  assert.equal(activityDensityForItemCount(1), 'light');
  assert.equal(activityDensityForItemCount(2), 'light');
  assert.equal(activityDensityForItemCount(3), 'medium');
  assert.equal(activityDensityForItemCount(4), 'medium');
  assert.equal(activityDensityForItemCount(5), 'packed');
});
