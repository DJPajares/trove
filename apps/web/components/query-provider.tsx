'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useState, type ReactNode } from 'react';

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
 * `userId` comes from the server render, so it lags a client-side sign-in by
 * one navigation. That direction is safe: an unknown user persists nothing and
 * runs on an in-memory cache, so the worst case is a cache that is not written
 * to disk yet, never one attributed to the wrong traveller. The `key` below
 * rebuilds the client outright if the account does change.
 */
export function QueryProvider({
  children,
  userId,
}: Readonly<{ children: ReactNode; userId: string | null }>) {
  const [signedOutClient] = useState(createQueryClient);

  if (!userId) {
    return <QueryClientProvider client={signedOutClient}>{children}</QueryClientProvider>;
  }

  return (
    <SignedInQueryProvider key={userId} userId={userId}>
      {children}
    </SignedInQueryProvider>
  );
}
