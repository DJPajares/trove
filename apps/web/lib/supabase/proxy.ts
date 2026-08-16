import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { getSupabaseEnvironment } from '@/lib/supabase/environment';

const protectedPathnames = ['/profile', '/saved', '/tools', '/trips'];
const authPathnames = ['/sign-in', '/sign-up'];

function isProtectedPath(pathname: string) {
  return protectedPathnames.some(
    (protectedPath) => pathname === protectedPath || pathname.startsWith(`${protectedPath}/`),
  );
}

function isAuthPath(pathname: string) {
  return authPathnames.includes(pathname);
}

/**
 * Signing in is done, so the auth routes have nothing left to offer. Send the
 * visitor wherever they were originally headed, or to Home.
 */
function redirectFromAuthPath(request: NextRequest, response: NextResponse) {
  const target = new URL(
    getSafeRedirectPath(request.nextUrl.searchParams.get('next')),
    request.nextUrl.origin,
  );

  const redirectResponse = NextResponse.redirect(target);

  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));

  return redirectResponse;
}

function redirectToSignIn(request: NextRequest, response: NextResponse) {
  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = '/sign-in';
  signInUrl.searchParams.set('next', request.nextUrl.pathname);

  const redirectResponse = NextResponse.redirect(signInUrl);

  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));

  return redirectResponse;
}

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const environment = getSupabaseEnvironment();

  if (!environment) {
    return isProtectedPath(request.nextUrl.pathname)
      ? redirectToSignIn(request, response)
      : response;
  }

  const supabase = createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (error || typeof userId !== 'string') {
    return isProtectedPath(request.nextUrl.pathname)
      ? redirectToSignIn(request, response)
      : response;
  }

  return isAuthPath(request.nextUrl.pathname) ? redirectFromAuthPath(request, response) : response;
}
