function hasUnsafeCharacters(path: string) {
  return (
    path.includes('\\') ||
    [...path].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  );
}

export function getSafeRedirectPath(path: string | null | undefined) {
  if (typeof path !== 'string' || !path.startsWith('/') || hasUnsafeCharacters(path)) {
    return '/';
  }

  try {
    const origin = 'https://trove.invalid';
    const url = new URL(path, origin);
    const pathname = decodeURIComponent(url.pathname);
    if (
      url.origin !== origin ||
      hasUnsafeCharacters(pathname) ||
      isAuthFlowPath(pathname) ||
      pathname === '/onboarding' ||
      pathname.startsWith('/onboarding/')
    ) {
      return '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function isAuthFlowPath(pathname: string) {
  return (
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    ['/sign-in', '/sign-up', '/forgot-password', '/reset-password'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  );
}

export function withAuthNext(path: string, next: string) {
  return `${path}?${new URLSearchParams({ next: getSafeRedirectPath(next) })}`;
}

export function buildEmailRedirectUrl(origin: string, next: string, flow: 'signup' | 'recovery') {
  const url = new URL('/auth/confirm', origin);
  url.searchParams.set('flow', flow);
  url.searchParams.set('next', getSafeRedirectPath(next));
  return url.toString();
}

export function isSensitiveAuthUrl(url: URL) {
  return (
    isAuthFlowPath(url.pathname) ||
    ['token_hash', 'access_token', 'refresh_token', 'code'].some((key) => url.searchParams.has(key))
  );
}
