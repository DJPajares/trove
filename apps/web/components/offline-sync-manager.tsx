'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { registerLocalPrivateDataClearer } from '@/lib/auth/sign-out';
import {
  clearAllOfflineTripData,
  getRememberedOfflineUser,
  OFFLINE_DATA_REFRESH_EVENT,
} from '@/lib/offline/trip-store';
import { syncOfflineMutations } from '@/lib/offline/trip-sync';
import { removePersistedQueryCache } from '@/lib/query/persister';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function OfflineSyncManager() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const forgetPrivateData = async (userId?: string | null) => {
      queryClient.clear();
      if (userId) await removePersistedQueryCache(userId);
      await clearAllOfflineTripData();
    };

    const unregisterClearer = registerLocalPrivateDataClearer(() =>
      forgetPrivateData(getRememberedOfflineUser()),
    );

    const sync = () => {
      if (navigator.onLine) void syncOfflineMutations().catch(() => undefined);
    };

    /**
     * A cached read may itself have come from the offline snapshot, because the
     * fetcher fell back after the network failed. Coming back online - or
     * finishing a sync that replayed queued writes - has to discard those, or a
     * reconnected tab keeps serving the offline answer for the rest of its
     * stale window.
     */
    const invalidateAfterReconnect = () => {
      void queryClient.invalidateQueries();
    };

    const reconnect = () => {
      sync();
      invalidateAfterReconnect();
    };

    sync();
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', sync);
    window.addEventListener(OFFLINE_DATA_REFRESH_EVENT, invalidateAfterReconnect);

    const supabase = createBrowserSupabaseClient();
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        const previousUserId = getRememberedOfflineUser();
        if (previousUserId && session && previousUserId !== session.user.id) {
          void forgetPrivateData(previousUserId).then(sync);
          return;
        }
        sync();
      }
      if (event === 'TOKEN_REFRESHED') sync();
      if (event === 'SIGNED_OUT') void forgetPrivateData(getRememberedOfflineUser());
    }).data.subscription;

    return () => {
      unregisterClearer();
      subscription?.unsubscribe();
      window.removeEventListener(OFFLINE_DATA_REFRESH_EVENT, invalidateAfterReconnect);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', reconnect);
    };
  }, [queryClient]);

  return null;
}
