import type { SupabaseClient } from '@supabase/supabase-js';

export const RECOVERY_WINDOW_SECONDS = 3600;
export type RecoveryIdentity = { userId: string; sessionId: string; email: string };

/** Only call with claims already verified by Supabase, never decoded URL tokens. */
export function recoveryIdentityFromClaims(
  claims: Record<string, unknown>,
  user: { id: string; email?: string },
  now = Date.now() / 1000,
): RecoveryIdentity | null {
  if (
    claims.sub !== user.id ||
    claims.role !== 'authenticated' ||
    typeof claims.session_id !== 'string' ||
    !claims.session_id ||
    !user.email ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    !Array.isArray(claims.amr)
  )
    return null;
  const recentRecovery = claims.amr.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const method = entry as Record<string, unknown>;
    return (
      method.method === 'recovery' &&
      typeof method.timestamp === 'number' &&
      method.timestamp <= now + 60 &&
      method.timestamp > now - RECOVERY_WINDOW_SECONDS
    );
  });
  return recentRecovery
    ? { userId: user.id, sessionId: claims.session_id, email: user.email }
    : null;
}

export async function getValidatedAuthIdentity(supabase: SupabaseClient, accessToken?: string) {
  const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return null;
  const [claimsResult, userResult] = await Promise.all([
    supabase.auth.getClaims(token),
    supabase.auth.getUser(token),
  ]);
  const claims = claimsResult.data?.claims;
  const user = userResult.data.user;
  if (
    claimsResult.error ||
    userResult.error ||
    !claims ||
    !user ||
    claims.sub !== user.id ||
    claims.role !== 'authenticated'
  )
    return null;
  return { claims, user, recovery: recoveryIdentityFromClaims(claims, user) };
}
