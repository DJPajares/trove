import { expect, test } from 'vitest';

import { getPreferenceDefaults, toggleAppearance } from '../lib/profile/preferences.ts';

test('appearance defaults to Light for every locale', () => {
  expect(getPreferenceDefaults('en-US').appearance).toBe('light');
  expect(getPreferenceDefaults('en-SG').appearance).toBe('light');
});

test('appearance toggles only between Light and Dark', () => {
  expect(toggleAppearance('light')).toBe('dark');
  expect(toggleAppearance('dark')).toBe('light');
});
