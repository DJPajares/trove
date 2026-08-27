import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseEnvironment } from '@/lib/supabase/environment';

let browserClient: SupabaseClient | null | undefined;

/**
 * The browser's Supabase client, built once.
 *
 * Every request Trove makes asks for the session first, and a screen makes
 * several: a fresh client per call re-reads the auth store and re-enters its
 * lock each time, for an answer that was already in hand. The singleton is
 * scoped to the browser — on the server this still builds per call, because a
 * module-level client there would be shared between two people's requests.
 */
export function createBrowserSupabaseClient() {
  if (typeof window === 'undefined') {
    const environment = getSupabaseEnvironment();
    return environment ? createBrowserClient(environment.url, environment.publishableKey) : null;
  }

  if (browserClient !== undefined) return browserClient;

  const environment = getSupabaseEnvironment();
  browserClient = environment
    ? createBrowserClient(environment.url, environment.publishableKey)
    : null;

  return browserClient;
}

let inFlightSession: Promise<Session | null> | null = null;

/**
 * The current session, with concurrent callers sharing one answer.
 *
 * Opening a trip asks three different things for a token at once — the screen's
 * own data, the trip, and its photograph. They used to queue behind three
 * separate reads of the same store. This does not cache the result: an expiring
 * token has to be allowed to refresh, and `getSession` is the thing that knows
 * when that is due.
 */
export async function getBrowserSession() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) return null;

  inFlightSession ??= supabase.auth
    .getSession()
    .then(({ data, error }) => (error ? null : data.session))
    .catch(() => null)
    .finally(() => {
      inFlightSession = null;
    });

  return inFlightSession;
}
