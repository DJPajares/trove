import type { SupabaseClient } from '@supabase/supabase-js';

import { validateEmailLink, type EmailLinkError } from '@/lib/auth/email-link';
import { getSafeRedirectPath, withAuthNext } from '@/lib/auth/redirect';
import { getValidatedAuthIdentity, sessionIdentityFromClaims } from '@/lib/auth/recovery';
import { recoveryFromGrant, type RecoveryGrant } from '@/lib/auth/recovery-grant';

export function authErrorKey(error: { code?: string; status?: number } | null): EmailLinkError {
  if (
    error?.code === 'otp_expired' ||
    error?.code === 'flow_state_expired' ||
    error?.code === 'flow_state_not_found'
  )
    return 'expiredLink';
  return error?.status === 0 || (error?.status && error.status >= 500)
    ? 'networkError'
    : 'invalidLink';
}

export async function completeEmailAuth(supabase: SupabaseClient, input: unknown) {
  const link = validateEmailLink(input);
  if (!link) return { error: 'invalidLink' as const };

  // Validate legacy bearer tokens before replacing a possibly unrelated session.
  if (link.kind === 'tokens') {
    const identity = await getValidatedAuthIdentity(supabase, link.accessToken);
    if (!identity || (link.recovery && !identity.recovery))
      return { error: 'invalidLink' as const };
  }
  const result =
    link.kind === 'otp'
      ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
      : link.kind === 'code'
        ? await supabase.auth.exchangeCodeForSession(
            link.code,
            link.flowId ? { flowId: link.flowId } : undefined,
          )
        : await supabase.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
  if (result.error || !result.data.session) return { error: authErrorKey(result.error) };
  const identity = await getValidatedAuthIdentity(supabase, result.data.session.access_token);
  if (!identity) return { error: 'invalidLink' as const };
  // POST /verify issues amr: otp even for recovery. Only successful verification
  // of a recovery token hash proves this path; an ordinary OTP JWT does not.
  const recovery =
    link.kind === 'otp' && link.type === 'recovery'
      ? sessionIdentityFromClaims(identity.claims, identity.user)
      : identity.recovery;
  if (link.recovery && !recovery) return { error: 'invalidLink' as const };
  return {
    userId: identity.user.id,
    redirect: recovery ? withAuthNext('/reset-password', link.next) : link.next,
    recovery,
    // The browser owns these credentials already. Installing this verified
    // session there keeps its cookie store and other open tabs in sync.
    session: {
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
    },
  };
}

export async function resetRecoveryPassword(
  supabase: SupabaseClient,
  input: unknown,
  grant?: RecoveryGrant | null,
) {
  if (!input || typeof input !== 'object') return { error: 'invalidLink' as const };
  const form = input as Record<string, unknown>;
  const identity = await getValidatedAuthIdentity(supabase);
  const recovery = identity?.recovery ?? recoveryFromGrant(identity, grant);
  if (!recovery || recovery.userId !== form.userId || recovery.sessionId !== form.sessionId)
    return { error: 'invalidLink' as const };
  if (typeof form.password !== 'string' || form.password.length < 6) {
    return { error: 'passwordTooShort' as const };
  }
  if (form.password.length > 1024) return { error: 'weakPassword' as const };
  if (form.password !== form.confirmation) return { error: 'passwordMismatch' as const };
  const { error } = await supabase.auth.updateUser({ password: form.password });
  if (error) {
    if (error.code === 'same_password') return { error: 'samePassword' as const };
    if (error.code === 'weak_password') return { error: 'weakPassword' as const };
    if (error.code === 'over_request_rate_limit') return { error: 'rateLimit' as const };
    return {
      error:
        (error.status ?? 400) >= 500 || error.status === 0
          ? ('networkError' as const)
          : ('resetError' as const),
    };
  }
  // Supabase's password update revokes other refresh sessions atomically and
  // retains this session. An extra signOut here would introduce a failure gap.
  return { redirect: getSafeRedirectPath(typeof form.next === 'string' ? form.next : '/') };
}
