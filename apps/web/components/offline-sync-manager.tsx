'use client';

import { useEffect } from 'react';

import { registerLocalPrivateDataClearer } from '@/lib/auth/sign-out';
import { clearAllOfflineTripData, getRememberedOfflineUser } from '@/lib/offline/trip-store';
import { syncOfflineMutations } from '@/lib/offline/trip-sync';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function OfflineSyncManager() {
  useEffect(() => {
    const unregisterClearer = registerLocalPrivateDataClearer(clearAllOfflineTripData);
    const sync = () => {
      if (navigator.onLine) void syncOfflineMutations().catch(() => undefined);
    };

    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);

    const supabase = createBrowserSupabaseClient();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        const previousUserId = getRememberedOfflineUser();
        if (previousUserId && session && previousUserId !== session.user.id) {
          void clearAllOfflineTripData().then(sync);
          return;
        }
        sync();
      }
      if (event === 'TOKEN_REFRESHED') sync();
      if (event === 'SIGNED_OUT') void clearAllOfflineTripData();
    }).data.subscription;

    return () => {
      unregisterClearer();
      subscription?.unsubscribe();
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
    };
  }, []);

  return null;
}
