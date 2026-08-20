import { expect, test } from 'vitest';

import { activityDensityForItemCount } from '../lib/activity-density.ts';

test('maps itinerary item counts to activity-density thresholds', () => {
  expect(activityDensityForItemCount(0)).toBe(null);
  expect(activityDensityForItemCount(1)).toBe('light');
  expect(activityDensityForItemCount(2)).toBe('light');
  expect(activityDensityForItemCount(3)).toBe('medium');
  expect(activityDensityForItemCount(4)).toBe('medium');
  expect(activityDensityForItemCount(5)).toBe('packed');
});
