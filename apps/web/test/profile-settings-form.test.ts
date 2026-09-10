import { expect, test } from 'vitest';

import {
  haveSavedProfileSettingsChanged,
  normalizeSavedProfileSettings,
  type ProfileSettingsFormState,
} from '../lib/profile/settings-form.ts';

const saved: ProfileSettingsFormState = {
  appearance: 'light',
  dateFormat: 'dmy',
  distanceUnit: 'km',
  displayName: 'Aroha Ngata',
  homeCountryCode: 'NZ',
  homeCurrencyCode: 'NZD',
  temperatureUnit: 'celsius',
  timeFormat: '24h',
};

test('unchanged settings are not dirty', () => {
  const baseline = normalizeSavedProfileSettings(saved);

  expect(haveSavedProfileSettingsChanged(saved, baseline)).toBe(false);
});

test('personal fields compare their normalized values', () => {
  const baseline = normalizeSavedProfileSettings(saved);
  const padded = {
    ...saved,
    displayName: '  Aroha Ngata  ',
    homeCountryCode: ' nz ',
    homeCurrencyCode: ' nzd ',
  };

  expect(haveSavedProfileSettingsChanged(padded, baseline)).toBe(false);
});

test('changed travel preferences are dirty', () => {
  const baseline = normalizeSavedProfileSettings(saved);

  expect(haveSavedProfileSettingsChanged({ ...saved, distanceUnit: 'mi' }, baseline)).toBe(true);
});

test('a newly saved baseline resets dirty state', () => {
  const changed = { ...saved, temperatureUnit: 'fahrenheit' as const };
  const initialBaseline = normalizeSavedProfileSettings(saved);
  const nextBaseline = normalizeSavedProfileSettings(changed);

  expect(haveSavedProfileSettingsChanged(changed, initialBaseline)).toBe(true);
  expect(haveSavedProfileSettingsChanged(changed, nextBaseline)).toBe(false);
});

test('appearance changes are excluded from explicit save state', () => {
  const baseline = normalizeSavedProfileSettings(saved);

  expect(haveSavedProfileSettingsChanged({ ...saved, appearance: 'dark' }, baseline)).toBe(false);
});
