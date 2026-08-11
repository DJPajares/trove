import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseEnvironment } from '@/lib/supabase/environment';

export function createBrowserSupabaseClient() {
  const environment = getSupabaseEnvironment();

  if (!environment) {
    return null;
  }

  return createBrowserClient(environment.url, environment.publishableKey);
}
