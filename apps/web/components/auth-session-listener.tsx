'use client';

import { useEffect } from 'react';

import { getSafeRedirectPath, isAuthFlowPath, withAuthNext } from '@/lib/auth/redirect';
import { getValidatedAuthIdentity } from '@/lib/auth/recovery';
import { clearLocalPrivateData } from '@/lib/auth/sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/** Keep already-open tabs aligned with a completed recovery or account switch. */
export function AuthSessionListener({ userId }: Readonly<{ userId: string | null }>) {
  useEffect(() => {
    const incoming = new URL(window.location.href);
    if (!['/auth/confirm', '/auth/callback'].includes(incoming.pathname)) {
      const fragment = new URLSearchParams(incoming.hash.slice(1));
      const keys = ['token_hash', 'code', 'access_token', 'refresh_token'];
      if (
        keys.some((key) => incoming.searchParams.has(key) || fragment.has(key)) ||
        fragment.has('error') ||
        fragment.has('error_code')
      ) {
        incoming.pathname = '/auth/callback';
        window.location.replace(incoming.toString());
        return;
      }
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return;
    let active = true;
    let lastToken: string | undefined;
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        lastToken = session?.access_token;
        return;
      }
      if (event !== 'SIGNED_IN' && event !== 'PASSWORD_RECOVERY') return;
      if (!session || (event === 'SIGNED_IN' && lastToken === session.access_token)) return;
      lastToken = session.access_token;
      // Confirmation owns its own navigation. Other auth screens, including an
      // already-open reset form, must follow a new recovery session.
      if (['/auth/confirm', '/auth/callback'].includes(window.location.pathname)) return;
      // Do not await Auth methods in an Auth callback: the SDK holds its lock.
      setTimeout(() => {
        void (async () => {
          const identity = await getValidatedAuthIdentity(supabase, session.access_token);
          if (!active || !identity) return;
          if (identity.user.id !== userId) await clearLocalPrivateData();
          if (!active) return;
          const current = new URL(window.location.href);
          if (['/auth/confirm', '/auth/callback'].includes(current.pathname)) return;
          if (identity.recovery) {
            const next =
              current.searchParams.get('next') ??
              `${current.pathname}${current.search}${current.hash}`;
            window.location.replace(withAuthNext('/reset-password', next));
          } else if (identity.user.id !== userId && !isAuthFlowPath(current.pathname))
            window.location.replace(
              getSafeRedirectPath(
                `${window.location.pathname}${window.location.search}${window.location.hash}`,
              ),
            );
        })().catch(() => undefined);
      }, 0);
    }).data.subscription;
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [userId]);
  return null;
}
