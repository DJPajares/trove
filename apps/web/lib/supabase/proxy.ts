import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getSupabaseEnvironment } from '@/lib/supabase/environment';

const protectedPathnames = ['/profile', '/saved', '/tools', '/trips'];

function isProtectedPath(pathname: string) {
  return protectedPathnames.some(
    (protectedPath) => pathname === protectedPath || pathname.startsWith(`${protectedPath}/`),
  );
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

  return response;
}
