import { NextResponse } from 'next/server';

import { completeEmailAuth } from '@/lib/auth/email-flow';
import { validateEmailLink } from '@/lib/auth/email-link';
import { AUTH_RESPONSE_HEADERS, isSameOriginAuthPost } from '@/lib/auth/http';
import { writeRecoveryCookie } from '@/lib/auth/recovery-cookie';
import { recoverySigningKey } from '@/lib/auth/recovery-grant';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const headers = new Headers(AUTH_RESPONSE_HEADERS);
  const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
  if (!isSameOriginAuthPost(request)) return reply({ error: 'invalidLink' }, 403);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ error: 'invalidLink' }, 400);
  }
  try {
    const link = validateEmailLink(input);
    if (!link) return reply({ error: 'invalidLink' }, 400);
    const needsGrant = link.kind === 'otp' && link.type === 'recovery';
    // Fail before consuming the one-use link if the deployment is not ready.
    if (needsGrant && !recoverySigningKey()) return reply({ error: 'configurationError' }, 503);
    const supabase = await createServerSupabaseClient(headers);
    if (!supabase) return reply({ error: 'configurationError' }, 503);
    const result = await completeEmailAuth(supabase, link);
    if ('error' in result) return reply(result, 400);
    const { recovery, ...session } = result;
    await writeRecoveryCookie(needsGrant ? recovery : null);
    return reply(session);
  } catch {
    return reply({ error: 'networkError' }, 503);
  }
}
