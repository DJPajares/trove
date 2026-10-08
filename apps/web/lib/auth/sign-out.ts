import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { clearPushForSignOut } from '@/lib/notifications/push';

type LocalPrivateDataClearer = () => Promise<void> | void;

const localPrivateDataClearers = new Set<LocalPrivateDataClearer>();
let clearingPrivateData: Promise<void> | null = null;

export function registerLocalPrivateDataClearer(clearer: LocalPrivateDataClearer) {
  localPrivateDataClearers.add(clearer);

  return () => localPrivateDataClearers.delete(clearer);
}

export async function clearLocalPrivateData() {
  clearingPrivateData ??= Promise.all([...localPrivateDataClearers].map((clearer) => clearer()))
    .then(() => undefined)
    .finally(() => {
      clearingPrivateData = null;
    });
  await clearingPrivateData;
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
    await clearLocalPrivateData();
  }
}
