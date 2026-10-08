'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isAuthFlowPath } from '@/lib/auth/redirect';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import {
  createQueryClient,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_VERSION,
  shouldDehydrateQuery,
} from '@/lib/query/client';
import { createQueryPersister } from '@/lib/query/persister';

function SignedInQueryProvider({
  children,
  userId,
}: Readonly<{ children: ReactNode; userId: string }>) {
  const [client] = useState(createQueryClient);
  const [persister] = useState(() => createQueryPersister(userId));

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
      if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT') {
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
