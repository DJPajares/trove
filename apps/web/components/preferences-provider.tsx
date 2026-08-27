'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  fetchProfile,
  saveProfile as persistProfile,
  type Profile,
  type ProfileUpdate,
} from '@/lib/profile/api';
import {
  getPreferenceDefaults,
  type Appearance,
  type ProfilePreferences,
} from '@/lib/profile/preferences';
import { queryKeys } from '@/lib/query/keys';

type PreferencesStatus = 'loading' | 'ready' | 'unavailable';

type PreferencesContextValue = {
  appearanceSaveError: boolean;
  preferredCurrency: string | null;
  preferences: ProfilePreferences;
  profile: Profile | null;
  saveProfileChanges: (changes: ProfileUpdate) => Promise<Profile>;
  setAppearance: (appearance: Appearance) => void;
  status: PreferencesStatus;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function preferencesFromProfile(
  profile: Profile,
  defaults: ProfilePreferences,
): ProfilePreferences {
  return {
    appearance: profile.appearance ?? defaults.appearance,
    dateFormat: profile.dateFormat ?? defaults.dateFormat,
    distanceUnit: profile.distanceUnit ?? defaults.distanceUnit,
    temperatureUnit: profile.temperatureUnit ?? defaults.temperatureUnit,
    timeFormat: profile.timeFormat ?? defaults.timeFormat,
  };
}

function isSignedOutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === 'not_authenticated' || error.message === 'supabase_not_configured')
  );
}

export function PreferencesProvider({
  children,
  locale,
}: Readonly<{ children: ReactNode; locale: string }>) {
  const defaults = useMemo(() => getPreferenceDefaults(locale), [locale]);
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryFn: fetchProfile, queryKey: queryKeys.profile() });
  const profile = profileQuery.data?.profile ?? null;
  const [preferences, setPreferences] = useState<ProfilePreferences>(defaults);
  const status: PreferencesStatus = profileQuery.isPending
    ? 'loading'
    : profileQuery.error
      ? 'unavailable'
      : 'ready';
  const [appearanceSaveError, setAppearanceSaveError] = useState(false);
  const appearanceRevision = useRef(0);
  const appearanceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const setThemeRef = useRef(setTheme);

  useEffect(() => {
    setThemeRef.current = setTheme;
  }, [setTheme]);

  // next-themes recreates its setter whenever the theme changes. Keeping the
  // latest setter behind a stable callback prevents the profile-sync effect
  // from running again mid-toggle and briefly repainting the previous theme.
  const applyAppearance = useCallback((appearance: Appearance) => {
    setThemeRef.current(appearance);
  }, []);

  // The traveller may have toggled appearance while the profile was still in
  // flight. `appearanceRevision` counts those toggles, so a profile that landed
  // after one is applied for everything except appearance - otherwise the
  // screen would briefly repaint the theme they just moved away from.
  const appliedProfileRef = useRef<Profile | null>(null);

  /**
   * Writes a just-saved profile back into the cache without a second round trip.
   *
   * It is marked applied first so the effect below leaves it alone: each save
   * path already decided what should happen to `preferences`, and in particular
   * whether an appearance the traveller is mid-toggle on should survive.
   */
  const writeProfile = useCallback(
    (nextProfile: Profile) => {
      appliedProfileRef.current = nextProfile;
      queryClient.setQueryData(queryKeys.profile(), { profile: nextProfile });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!profile || appliedProfileRef.current === profile) return;

    const revisionAtLoad = appearanceRevision.current;
    appliedProfileRef.current = profile;

    const loaded = preferencesFromProfile(profile, defaults);
    const shouldApplyLoadedAppearance = appearanceRevision.current === revisionAtLoad;
    setPreferences((current) => {
      const appearance = shouldApplyLoadedAppearance ? loaded.appearance : current.appearance;
      return { ...loaded, appearance };
    });
    if (shouldApplyLoadedAppearance) applyAppearance(loaded.appearance);
  }, [applyAppearance, defaults, profile]);

  const setAppearance = useCallback(
    (appearance: Appearance) => {
      const revision = ++appearanceRevision.current;
      setPreferences((current) => ({ ...current, appearance }));
      applyAppearance(appearance);
      setAppearanceSaveError(false);

      appearanceSaveQueue.current = appearanceSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const { profile: nextProfile } = await persistProfile({ appearance });
            writeProfile(nextProfile);
            if (appearanceRevision.current === revision) setAppearanceSaveError(false);
          } catch (error) {
            if (appearanceRevision.current === revision && !isSignedOutError(error)) {
              setAppearanceSaveError(true);
            }
          }
        });
    },
    [applyAppearance, writeProfile],
  );

  const saveProfileChanges = useCallback(
    async (changes: ProfileUpdate) => {
      await appearanceSaveQueue.current.catch(() => undefined);
      const { profile: nextProfile } = await persistProfile(changes);
      writeProfile(nextProfile);
      setPreferences((current) => {
        const next = preferencesFromProfile(nextProfile, defaults);
        return changes.appearance === undefined
          ? { ...next, appearance: current.appearance }
          : next;
      });
      if (changes.appearance) setAppearanceSaveError(false);
      return nextProfile;
    },
    [defaults, writeProfile],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      appearanceSaveError,
      preferredCurrency: profile?.homeCurrencyCode?.trim().toUpperCase() || null,
      preferences,
      profile,
      saveProfileChanges,
      setAppearance,
      status,
    }),
    [appearanceSaveError, preferences, profile, saveProfileChanges, setAppearance, status],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used within PreferencesProvider');
  return context;
}
