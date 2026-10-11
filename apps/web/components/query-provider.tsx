'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isAuthFlowPath } from '@/lib/auth/redirect';
import { isAuthDeparting, subscribeAuthTransition } from '@/lib/auth/transition';
import { registerLocalPrivateDataClearer } from '@/lib/auth/sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import {
  createQueryClient,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_VERSION,
  shouldDehydrateQuery,
} from '@/lib/query/client';
import {
  bindWeatherAccount,
  disposeWeatherAccount,
  hasWeatherAccount,
} from '@/lib/weather/client-service';
import { createQueryPersister, removePersistedQueryCache } from '@/lib/query/persister';

function SignedInQueryProvider({
  children,
  userId,
}: Readonly<{ children: ReactNode; userId: string }>) {
  const [client] = useState(() => {
    const next = createQueryClient();
    bindWeatherAccount(next, userId);
    return next;
  });
  useEffect(() => {
    bindWeatherAccount(client, userId);
    return () => disposeWeatherAccount(client);
  }, [client, userId]);
  useEffect(
    () =>
      registerLocalPrivateDataClearer(async () => {
        await client.cancelQueries();
        client.clear();
        disposeWeatherAccount(client, true);
        // Use the provider's owner even when no offline trip has been selected.
        await removePersistedQueryCache(userId);
      }),
    [client, userId],
  );
  useEffect(
    () =>
      subscribeAuthTransition(() => {
        // Cancel queries silently before transport aborts become cached errors.
        // A failed manual logout can then restore the valid session safely.
        if (isAuthDeparting()) void client.cancelQueries();
      }),
    [client],
  );
  useEffect(() => {
    const subscription = createBrowserSupabaseClient()?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && session?.user.id !== userId))
        disposeWeatherAccount(client, true);
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, [client, userId]);
  const [persister] = useState(() =>
    createQueryPersister(userId, () => !isAuthDeparting() && hasWeatherAccount(client, userId)),
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        buster: QUERY_CACHE_VERSION,
        dehydrateOptions: { shouldDehydrateQuery },
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        persister,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

/**
 * The read cache for the whole app.
 *
 * This sits above `PwaProvider` because both the notification poller and the
 * offline sync manager live inside it and need the same client - the sync
 * manager is what clears this cache when a traveller signs out or a different
 * account signs in.
 *
 * Auth events partition the cache immediately when an open tab changes
 * accounts, before the server layout catches up. Auth screens always use an
 * in-memory cache. The `key` rebuilds the persisted client for each account.
 */
export function QueryProvider({
  children,
  userId,
}: Readonly<{ children: ReactNode; userId: string | null }>) {
  const [signedOutClient] = useState(createQueryClient);
  const [liveUserId, setLiveUserId] = useState(userId);
  const pathname = usePathname();

  useEffect(() => {
    setLiveUserId(userId);
  }, [userId]);
  useEffect(() => {
    const subscription = createBrowserSupabaseClient()?.auth.onAuthStateChange((event, session) => {
      // Partition data immediately when another tab changes accounts; waiting
      // for the server layout would persist the new user's data under the old ID.
      if (isAuthDeparting()) return;
      // Departure owns cancellation and cleanup while retaining this client.
      // Swapping it on SIGNED_OUT remounts the still-authenticated server tree.
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') {
        setLiveUserId(session?.user.id ?? null);
      }
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  if (!liveUserId || isAuthFlowPath(pathname)) {
    return <QueryClientProvider client={signedOutClient}>{children}</QueryClientProvider>;
  }

  return (
    <SignedInQueryProvider key={liveUserId} userId={liveUserId}>
      {children}
    </SignedInQueryProvider>
  );
}
