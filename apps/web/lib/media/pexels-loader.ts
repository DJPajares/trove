import type { ImageLoaderProps } from 'next/image';

const PEXELS_IMAGE_HOST = 'images.pexels.com';

/**
 * Sizes an editorial photograph at the provider, not through Next's optimizer.
 *
 * Editorial imagery is hotlinked by contract: Trove never stores a copy, so
 * routing these bytes through `/_next/image` would both cache provider pixels
 * Trove is not entitled to keep and bill an optimization unit for a decoration.
 * Pexels already resizes on demand through its own `w` parameter, so a loader
 * that rewrites it gives a real `srcset` at zero cost and keeps the request a
 * plain hotlink.
 *
 * A non-Pexels URL passes through untouched, so this stays safe as the single
 * loader for the media frame even when the source is a Supabase cover.
 */
export function pexelsImageLoader({ src, width }: ImageLoaderProps) {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }

  if (url.hostname !== PEXELS_IMAGE_HOST) return src;

  url.searchParams.set('w', String(width));
  // A height alongside the width would crop rather than scale, and the frame
  // already owns the aspect ratio. The provider's own `dpr` would multiply the
  // width a second time on top of the density Next has already asked for.
  url.searchParams.delete('dpr');
  url.searchParams.delete('h');

  return url.toString();
}
