'use client';

import { useEffect } from 'react';

import { getSafeRedirectPath, isAuthFlowPath, withAuthNext } from '@/lib/auth/redirect';
import { getValidatedAuthIdentity } from '@/lib/auth/recovery';
import { clearLocalPrivateData } from '@/lib/auth/sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/** Keep already-open tabs aligned with a completed recovery or account switch. */
export function AuthSessionListener({
  userId,
  sessionId,
}: Readonly<{ userId: string | null; sessionId: string | null }>) {
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
    let navigating = false;
    let lastToken: string | undefined;
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        lastToken = session?.access_token;
        return;
      }
      if (event !== 'SIGNED_IN' && event !== 'PASSWORD_RECOVERY') return;
      if (!session || navigating || lastToken === session.access_token) return;
      lastToken = session.access_token;
      // Confirmation owns its own navigation. Other auth screens, including an
      // already-open reset form, must follow a new recovery session.
      if (['/auth/confirm', '/auth/callback'].includes(window.location.pathname)) return;
      // Do not await Auth methods in an Auth callback: the SDK holds its lock.
      setTimeout(() => {
        void (async () => {
          const identity = await getValidatedAuthIdentity(supabase, session.access_token);
          if (!active || !identity) return;
          let recovery = !!identity.recovery;
          if (
            !recovery &&
            Array.isArray(identity.claims.amr) &&
            identity.claims.amr.some(
              (method) => typeof method === 'object' && method !== null && method.method === 'otp',
            )
          ) {
            // Recovery hash verification creates an OTP JWT. Its server-signed
            // receipt is HttpOnly and must be checked on the server, not decoded here.
            try {
              const response = await fetch('/auth/recovery-session', { cache: 'no-store' });
              if (response.ok) {
                const status = (await response.json()) as {
                  recovery: boolean;
                  userId: string;
                  sessionId: string;
                };
                recovery =
                  status.recovery === true &&
                  status.userId === identity.user.id &&
                  status.sessionId === identity.claims.session_id;
              }
            } catch {
              // Recovery fails closed; a verified account switch must still clear
              // the previous account's private data when the status request fails.
              recovery = false;
            }
          }
          if (!active || navigating) return;
          if (identity.user.id !== userId) await clearLocalPrivateData();
          if (!active || navigating) return;
          const current = new URL(window.location.href);
          if (['/auth/confirm', '/auth/callback'].includes(current.pathname)) return;
          if (recovery) {
            // Restoring a stored session can emit SIGNED_IN before INITIAL_SESSION.
            // Keep the form rendered for this user/session; a different session
            // still reloads it so the server replaces the stale reset identity.
            if (
              current.pathname === '/reset-password' &&
              identity.user.id === userId &&
              identity.claims.session_id === sessionId
            )
              return;
            const next =
              current.searchParams.get('next') ??
              `${current.pathname}${current.search}${current.hash}`;
            navigating = true;
            window.location.replace(withAuthNext('/reset-password', next));
          } else if (identity.user.id !== userId && !isAuthFlowPath(current.pathname)) {
            navigating = true;
            window.location.replace(
              getSafeRedirectPath(
                `${window.location.pathname}${window.location.search}${window.location.hash}`,
              ),
            );
          }
        })().catch(() => undefined);
      }, 0);
    }).data.subscription;
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [userId, sessionId]);
  return null;
}
