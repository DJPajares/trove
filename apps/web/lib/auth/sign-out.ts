import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { clearPushForSignOut } from '@/lib/notifications/push';

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

    await clearPushForSignOut().catch(() => undefined);
    const { error } = await supabase.auth.signOut({ scope: 'local' });

    if (error) {
      throw error;
    }
  } finally {
    await Promise.all([...localPrivateDataClearers].map((clearer) => clearer()));
  }
}
