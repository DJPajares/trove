'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { isProfileOnboarded } from '@/lib/profile/onboarding';

const EXEMPT_PATHS = ['/onboarding', '/sign-in', '/sign-up'];

function isExempt(pathname: string) {
  return EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Steers a newly authenticated user with an incomplete profile toward /onboarding
 * before they reach the rest of the app. Runs on every route change; a complete
 * profile or an exempt path is a no-op.
 */
export function OnboardingGate() {
  const { profile, status } = usePreferences();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'ready' || isExempt(pathname)) return;
    if (!isProfileOnboarded(profile)) router.replace('/onboarding');
  }, [pathname, profile, router, status]);

  return null;
}
