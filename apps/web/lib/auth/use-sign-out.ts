'use client';

import { useCallback, useState } from 'react';

import { signOutFromTrove } from '@/lib/auth/sign-out';
import { hasUnsyncedOfflineChanges } from '@/lib/offline/trip-store';

/**
 * Shares the sign-out contract between the header menu and Settings: unsynchronized
 * local changes must be surfaced before session and local private data are cleared.
 */
export function useSignOut(userId?: string) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasSignOutError, setHasSignOutError] = useState(false);
  const [showUnsyncedWarning, setShowUnsyncedWarning] = useState(false);

  const signOut = useCallback(async () => {
    setHasSignOutError(false);
    setIsSigningOut(true);
    try {
      await signOutFromTrove();
      setShowUnsyncedWarning(false);
      return true;
    } catch {
      setHasSignOutError(true);
      return false;
    } finally {
      setIsSigningOut(false);
    }
  }, []);

  const requestSignOut = useCallback(async () => {
    try {
      if (await hasUnsyncedOfflineChanges(userId)) {
        setShowUnsyncedWarning(true);
        return false;
      }
    } catch {
      // If local storage is unavailable there cannot be a readable queue to preserve.
    }
    return signOut();
  }, [signOut, userId]);

  return {
    hasSignOutError,
    isSigningOut,
    requestSignOut,
    setShowUnsyncedWarning,
    showUnsyncedWarning,
    signOut,
  };
}
