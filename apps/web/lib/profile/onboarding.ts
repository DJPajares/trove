import type { Profile } from '@/lib/profile/api';

type OnboardingProfile = Pick<Profile, 'displayName' | 'homeCountryCode' | 'homeCurrencyCode'>;

export function isProfileOnboarded(profile: OnboardingProfile | null) {
  if (!profile) return false;
  return Boolean(
    profile.displayName?.trim() &&
    profile.homeCountryCode?.trim() &&
    profile.homeCurrencyCode?.trim(),
  );
}
