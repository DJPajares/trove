'use client';

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
  const { setTheme, theme } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<ProfilePreferences>(defaults);
  const [status, setStatus] = useState<PreferencesStatus>('loading');
  const [appearanceSaveError, setAppearanceSaveError] = useState(false);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const appearanceRevision = useRef(0);
  const appearanceSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const appliedAppearance = useRef(theme);

  useEffect(() => {
    appliedAppearance.current = theme;
  }, [theme]);

  const applyAppearance = useCallback(
    (appearance: Appearance) => {
      if (appliedAppearance.current === appearance) return;

      appliedAppearance.current = appearance;
      setTheme(appearance);
    },
    [setTheme],
  );

  useEffect(() => {
    let active = true;
    const revisionAtLoad = appearanceRevision.current;

    void fetchProfile()
      .then(({ profile: nextProfile }) => {
        if (!active) return;

        const loaded = preferencesFromProfile(nextProfile, defaults);
        const shouldApplyLoadedAppearance = appearanceRevision.current === revisionAtLoad;
        setProfile(nextProfile);
        setPreferences((current) => {
          const appearance = shouldApplyLoadedAppearance ? loaded.appearance : current.appearance;
          return { ...loaded, appearance };
        });
        setAppearanceReady(true);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setAppearanceReady(true);
        setStatus('unavailable');
      });

    return () => {
      active = false;
    };
  }, [defaults]);

  useEffect(() => {
    if (!appearanceReady) return;
    applyAppearance(preferences.appearance);
  }, [appearanceReady, applyAppearance, preferences.appearance]);

  const setAppearance = useCallback(
    (appearance: Appearance) => {
      const revision = ++appearanceRevision.current;
      setPreferences((current) => ({ ...current, appearance }));
      setAppearanceReady(true);
      applyAppearance(appearance);
      setAppearanceSaveError(false);

      appearanceSaveQueue.current = appearanceSaveQueue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const { profile: nextProfile } = await persistProfile({ appearance });
            setProfile(nextProfile);
            setStatus('ready');
            if (appearanceRevision.current === revision) setAppearanceSaveError(false);
          } catch (error) {
            if (appearanceRevision.current === revision && !isSignedOutError(error)) {
              setAppearanceSaveError(true);
            }
          }
        });
    },
    [applyAppearance],
  );

  const saveProfileChanges = useCallback(
    async (changes: ProfileUpdate) => {
      await appearanceSaveQueue.current.catch(() => undefined);
      const { profile: nextProfile } = await persistProfile(changes);
      setProfile(nextProfile);
      setStatus('ready');
      setPreferences((current) => {
        const next = preferencesFromProfile(nextProfile, defaults);
        return changes.appearance === undefined
          ? { ...next, appearance: current.appearance }
          : next;
      });
      if (changes.appearance) setAppearanceSaveError(false);
      return nextProfile;
    },
    [defaults],
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
