import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { clearPushForSignOut } from '@/lib/notifications/push';
import { getAuthTransition, setAuthTransition } from '@/lib/auth/transition';

type LocalPrivateDataClearer = () => Promise<void> | void;

const localPrivateDataClearers = new Map<LocalPrivateDataClearer, boolean>();
let clearingPrivateData: Promise<void> | null = null;
let signingOut: Promise<void> | null = null;
let preserveOfflineWork = false;

export function registerLocalPrivateDataClearer(
  clearer: LocalPrivateDataClearer,
  options?: { preserveOnSessionLoss: boolean },
) {
  localPrivateDataClearers.set(clearer, options?.preserveOnSessionLoss ?? false);

  return () => {
    localPrivateDataClearers.delete(clearer);
  };
}

export async function clearLocalPrivateData(options?: { preserveOfflineWork: boolean }) {
  clearingPrivateData ??= Promise.all(
    [...localPrivateDataClearers]
      .filter(([, preserve]) => !(preserve && options?.preserveOfflineWork))
      .map(([clearer]) => Promise.resolve().then(clearer)),
  )
    .then(() => undefined)
    .finally(() => {
      clearingPrivateData = null;
    });
  await clearingPrivateData;
}

async function finishSignOut(allowRestore: boolean) {
  const supabase = createBrowserSupabaseClient();
  let sessionCleared = !supabase;
  try {
    await clearPushForSignOut().catch(() => undefined);
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      sessionCleared = true;
    }
    // PRD 28: unexpected authorization loss pauses sync without discarding
    // account-scoped unsynced work. Explicit logout already obtained its warning.
    await clearLocalPrivateData({ preserveOfflineWork });
    // Keep the departure state until the new document arrives. Client routing
    // would retain server components rendered with the previous identity.
    window.location.replace('/sign-in');
  } catch (error) {
    if (!sessionCleared && supabase) {
      const result = await supabase.auth.getSession().catch(() => null);
      sessionCleared = !result?.data.session;
    }
    // A failed manual revocation may safely return to the still-valid session.
    // Once the session is lost, never re-expose the previous account's screen.
    setAuthTransition(sessionCleared || !allowRestore ? 'cleanup-failed' : 'sign-out-failed');
    throw error;
  }
}

export function signOutFromTrove() {
  if (signingOut) return signingOut;
  const allowRestore = ['idle', 'sign-out-failed'].includes(getAuthTransition());
  if (getAuthTransition() !== 'cleanup-failed')
    preserveOfflineWork = getAuthTransition() === 'session-expired';
  if (getAuthTransition() !== 'session-expired') setAuthTransition('signing-out');
  signingOut = finishSignOut(allowRestore).finally(() => {
    signingOut = null;
  });
  return signingOut;
}
