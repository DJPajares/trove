import type { SupabaseClient } from '@supabase/supabase-js';

import { assertAuthRequestsAllowed, authRequestSignal, expireAuthSession } from './transition';

/** Preserve the SDK's response shape and offline handling, but reject stale reads. */
export async function getProtectedSession(supabase: SupabaseClient) {
  const signal = authRequestSignal();
  const result = await supabase.auth.getSession();
  signal.throwIfAborted();
  if (
    !result.data.session &&
    (!result.error || ((result.error.status ?? 0) >= 400 && (result.error.status ?? 0) < 500))
  ) {
    // A transport outage must not discard an offline traveller's session/work.
    if (typeof navigator === 'undefined' || navigator.onLine) expireAuthSession();
  }
  assertAuthRequestsAllowed();
  return result;
}

/** Cancel departing-account reads and never publish an answer after sign-out starts. */
export async function authenticatedFetch(input: string, init?: RequestInit) {
  const signal = authRequestSignal();
  const response = await fetch(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
  });
  signal.throwIfAborted();
  if (response.status === 401) expireAuthSession();
  assertAuthRequestsAllowed();
  return response;
}
