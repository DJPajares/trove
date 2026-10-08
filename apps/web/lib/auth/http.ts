export const AUTH_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
};

/** JSON POST endpoints accept only browser requests from their own origin. */
export function isSameOriginAuthPost(request: Request) {
  return (
    request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json'
  );
}
