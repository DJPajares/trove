import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * The server-side answer to "is anyone signed in". An unconfigured Supabase
 * environment reads as signed out, matching how the proxy already treats it.
 */
export async function getAuthUserId() {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  return error || typeof userId !== 'string' ? null : userId;
}
