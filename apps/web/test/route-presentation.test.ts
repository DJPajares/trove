import { expect, test } from 'vitest';

import { routePresentationState } from '../lib/itinerary/route-presentation.ts';

test('a current successful route is presented as estimated', () => {
  expect(routePresentationState('ok', false)).toBe('estimated');
});

test('a successful offline route is presented as cached', () => {
  expect(routePresentationState('ok', true)).toBe('cached');
});

test('intentional and failed gaps remain visually distinct', () => {
  expect(routePresentationState('not_estimated', false)).toBe('not-estimated');
  expect(routePresentationState('not_estimated', true)).toBe('not-estimated');
  expect(routePresentationState('unavailable', false)).toBe('unavailable');
  expect(routePresentationState('unavailable', true)).toBe('unavailable');
});
