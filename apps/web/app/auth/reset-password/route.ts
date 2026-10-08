import { NextResponse } from 'next/server';

import { resetRecoveryPassword } from '@/lib/auth/email-flow';
import { AUTH_RESPONSE_HEADERS, isSameOriginAuthPost } from '@/lib/auth/http';
import { readRecoveryCookie, writeRecoveryCookie } from '@/lib/auth/recovery-cookie';
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
    const supabase = await createServerSupabaseClient(headers);
    if (!supabase) return reply({ error: 'configurationError' }, 503);
    const result = await resetRecoveryPassword(supabase, input, await readRecoveryCookie());
    if (!('error' in result)) await writeRecoveryCookie(null);
    return reply(result, 'error' in result ? 400 : 200);
  } catch {
    return reply({ error: 'networkError' }, 503);
  }
}
