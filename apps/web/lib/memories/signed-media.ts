/**
 * Whether a Memory photo that failed to load is worth asking the server to
 * sign again.
 *
 * Photo links are signed for an hour, so a journal left open, or opened from a
 * cache, meets expired ones as a matter of course - and the only fix is a
 * fresh link. Everything else that fails is not an expired link: a local
 * preview of a photo still waiting to upload, a device with no connection, or
 * a HEIC file a browser other than Safari cannot decode (they are stored as
 * taken). Re-signing those would only refetch the same failure, so they show
 * their fallback and stay quiet. One refresh a minute at most, whatever fails.
 */
export const SIGNED_MEDIA_REFRESH_INTERVAL_MS = 60_000;

/** Safari decodes HEIC; other browsers get the file as taken and cannot. */
export function canDecodeHeic() {
  return typeof navigator !== 'undefined'
    ? /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)
    : false;
}

export function isHeicContentType(contentType: string | null | undefined) {
  return /^image\/hei[cf]$/i.test(contentType ?? '');
}

export function shouldRefreshSignedMedia({
  canDecodeHeic,
  contentType,
  lastRefreshAt,
  now,
  online,
  url,
}: Readonly<{
  canDecodeHeic: boolean;
  contentType: string | null;
  lastRefreshAt: number | null;
  now: number;
  online: boolean;
  url: string | null;
}>): boolean {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
  if (!online) return false;
  if (!canDecodeHeic && isHeicContentType(contentType)) return false;
  if (lastRefreshAt !== null && now - lastRefreshAt < SIGNED_MEDIA_REFRESH_INTERVAL_MS)
    return false;
  return true;
}
