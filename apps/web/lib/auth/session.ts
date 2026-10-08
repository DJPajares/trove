import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * The server-side answer to "is anyone signed in". An unconfigured Supabase
 * environment reads as signed out, matching how the proxy already treats it.
 */
export async function getAuthSessionIdentity() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || typeof userId !== 'string') return null;
  const sessionId = data?.claims?.session_id;
  return { userId, sessionId: typeof sessionId === 'string' ? sessionId : null };
}

export async function getAuthUserId() {
  return (await getAuthSessionIdentity())?.userId ?? null;
}
