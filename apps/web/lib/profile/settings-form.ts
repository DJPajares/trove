import type { Profile } from './api';
import { getPreferenceDefaults, type ProfilePreferences } from './preferences';

export type ProfileSettingsFormState = ProfilePreferences & {
  displayName: string;
  homeCurrencyCode: string;
  homeLocation: string;
};

export type SavedProfileSettings = Omit<ProfileSettingsFormState, 'appearance'>;

export function getProfileSettingsFormState(
  profile: Profile,
  locale: string,
): ProfileSettingsFormState {
  const defaults = getPreferenceDefaults(locale);

  return {
    ...defaults,
    appearance: profile.appearance ?? defaults.appearance,
    dateFormat: profile.dateFormat ?? defaults.dateFormat,
    distanceUnit: profile.distanceUnit ?? defaults.distanceUnit,
    displayName: profile.displayName ?? '',
    homeCurrencyCode: profile.homeCurrencyCode ?? '',
    homeLocation: profile.homeLocation ?? '',
    temperatureUnit: profile.temperatureUnit ?? defaults.temperatureUnit,
    timeFormat: profile.timeFormat ?? defaults.timeFormat,
  };
}

export function normalizeSavedProfileSettings(
  settings: ProfileSettingsFormState,
): SavedProfileSettings {
  return {
    dateFormat: settings.dateFormat,
    distanceUnit: settings.distanceUnit,
    displayName: settings.displayName.trim(),
    homeCurrencyCode: settings.homeCurrencyCode.trim().toUpperCase(),
    homeLocation: settings.homeLocation.trim(),
    temperatureUnit: settings.temperatureUnit,
    timeFormat: settings.timeFormat,
  };
}

export function haveSavedProfileSettingsChanged(
  current: ProfileSettingsFormState,
  baseline: SavedProfileSettings,
) {
  const normalized = normalizeSavedProfileSettings(current);

  return (Object.keys(baseline) as (keyof SavedProfileSettings)[]).some(
    (key) => normalized[key] !== baseline[key],
  );
}
