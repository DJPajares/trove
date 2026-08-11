import { createClient } from '@supabase/supabase-js';

import { getAuthenticationEnvironment } from '../environment.js';

export function createAuthenticatedSupabaseClient(accessToken: string) {
  const environment = getAuthenticationEnvironment();

  if (!environment) {
    return null;
  }

  return createClient(environment.url, environment.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function getAuthenticatedUserId(accessToken: string) {
  const environment = getAuthenticationEnvironment();

  if (!environment) {
    return { reason: 'configuration' as const, userId: null };
  }

  const supabase = createAuthenticatedSupabaseClient(accessToken);

  if (!supabase) {
    return { reason: 'configuration' as const, userId: null };
  }
  const { data, error } = await supabase.auth.getClaims(accessToken);
  const userId = data?.claims?.sub;

  if (error || typeof userId !== 'string') {
    return { reason: 'unauthorized' as const, userId: null };
  }

  return { reason: null, userId };
}
