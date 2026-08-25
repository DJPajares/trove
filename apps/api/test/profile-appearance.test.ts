import { expect, test } from 'vitest';

import { normalizeLegacyAppearance } from '../src/services/profile.js';

test('legacy System input is normalized to Light', () => {
  expect(normalizeLegacyAppearance('system')).toBe('light');
});

test('explicit Light and Dark inputs remain unchanged', () => {
  expect(normalizeLegacyAppearance('light')).toBe('light');
  expect(normalizeLegacyAppearance('dark')).toBe('dark');
});
