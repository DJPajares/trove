import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type LocalPrivateDataClearer = () => Promise<void> | void;

const localPrivateDataClearers = new Set<LocalPrivateDataClearer>();

export function registerLocalPrivateDataClearer(clearer: LocalPrivateDataClearer) {
  localPrivateDataClearers.add(clearer);

  return () => localPrivateDataClearers.delete(clearer);
}

export async function signOutFromTrove() {
  const supabase = createBrowserSupabaseClient();

  try {
    if (!supabase) {
      return;
    }

    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      throw error;
    }
  } finally {
    await Promise.all([...localPrivateDataClearers].map((clearer) => clearer()));
  }
}
