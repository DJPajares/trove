import { NextResponse } from 'next/server';

import { AUTH_RESPONSE_HEADERS } from '@/lib/auth/http';
import { readRecoveryCookie } from '@/lib/auth/recovery-cookie';
import { recoveryFromGrant } from '@/lib/auth/recovery-grant';
import { getValidatedAuthIdentity } from '@/lib/auth/recovery';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/** Read-only status for other open tabs; never returns bearer credentials. */
export async function GET() {
  const headers = new Headers(AUTH_RESPONSE_HEADERS);
  const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
  try {
    const supabase = await createServerSupabaseClient(headers);
    if (!supabase) return reply({ recovery: false }, 503);
    const identity = await getValidatedAuthIdentity(supabase);
    if (!identity) return reply({ recovery: false }, 401);
    const recovery = identity.recovery ?? recoveryFromGrant(identity, await readRecoveryCookie());
    return reply({
      recovery: !!recovery,
      userId: identity.user.id,
      sessionId: typeof identity.claims.session_id === 'string' ? identity.claims.session_id : null,
    });
  } catch {
    return reply({ recovery: false }, 503);
  }
}
