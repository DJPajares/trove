import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getSupabaseEnvironment } from '@/lib/supabase/environment';

export async function createServerSupabaseClient(responseHeaders?: Headers) {
  const environment = getSupabaseEnvironment();

  if (!environment) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        Object.entries(headers).forEach(([key, value]) => responseHeaders?.set(key, value));
        try {
          cookiesToSet.forEach(({ name, options, value }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. The proxy refreshes sessions.
        }
      },
    },
  });
}
