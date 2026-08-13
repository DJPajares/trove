import type { Profile } from '@/lib/profile/api';

type OnboardingProfile = Pick<Profile, 'displayName' | 'homeCurrencyCode' | 'homeLocation'>;

export type OnboardingStep = 'currency' | 'location' | 'name';

export const ONBOARDING_STEPS: OnboardingStep[] = ['name', 'location', 'currency'];

export function isProfileOnboarded(profile: OnboardingProfile | null) {
  if (!profile) return false;
  return Boolean(
    profile.displayName?.trim() && profile.homeLocation?.trim() && profile.homeCurrencyCode?.trim(),
  );
}

/** Resumes onboarding at the first step whose value is not already saved. */
export function firstIncompleteStep(profile: OnboardingProfile | null): OnboardingStep {
  if (!profile?.displayName?.trim()) return 'name';
  if (!profile.homeLocation?.trim()) return 'location';
  return 'currency';
}
