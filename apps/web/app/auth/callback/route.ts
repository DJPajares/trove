import { NextResponse } from 'next/server';

import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = getSafeRedirectPath(requestUrl.searchParams.get('next'));
  const code = requestUrl.searchParams.get('code');
  const signInUrl = new URL('/sign-in', requestUrl.origin);

  if (!code) {
    signInUrl.searchParams.set('error', 'callback');
    return NextResponse.redirect(signInUrl);
  }

  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    signInUrl.searchParams.set('error', 'configuration');
    return NextResponse.redirect(signInUrl);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    signInUrl.searchParams.set('error', 'callback');
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
