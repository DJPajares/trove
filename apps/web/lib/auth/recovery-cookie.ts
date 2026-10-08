import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import {
  createRecoveryGrant,
  recoveryFromGrant,
  verifyRecoveryGrant,
} from '@/lib/auth/recovery-grant';
import {
  getValidatedAuthIdentity,
  RECOVERY_WINDOW_SECONDS,
  type RecoveryIdentity,
} from '@/lib/auth/recovery';

export const recoveryCookieName = () =>
  process.env.NODE_ENV === 'production' ? '__Host-trove-recovery' : 'trove-recovery';
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: RECOVERY_WINDOW_SECONDS,
});

export async function readRecoveryCookie() {
  return verifyRecoveryGrant((await cookies()).get(recoveryCookieName())?.value);
}

export async function writeRecoveryCookie(identity: RecoveryIdentity | null) {
  (await cookies()).set(recoveryCookieName(), identity ? createRecoveryGrant(identity) : '', {
    ...cookieOptions(),
    ...(identity ? {} : { maxAge: 0 }),
  });
}

export async function getServerRecoveryIdentity(supabase: SupabaseClient) {
  const identity = await getValidatedAuthIdentity(supabase);
  return identity?.recovery ?? recoveryFromGrant(identity, await readRecoveryCookie());
}
