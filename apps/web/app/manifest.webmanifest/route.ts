import { cookies } from 'next/headers';

import { buildManifest } from '@/lib/pwa/manifest';
import { APPEARANCE_COOKIE, readAppearanceCookie } from '@/lib/theme-cookie';

/**
 * Hand-rolled rather than Next's `app/manifest.ts` convention, because the link
 * tag that convention injects cannot carry `crossorigin="use-credentials"` - and
 * without it the manifest arrives with no cookie and no way to know which ground
 * the traveller opens on.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const theme = readAppearanceCookie(cookieStore.get(APPEARANCE_COOKIE)?.value);

  return Response.json(await buildManifest(theme), {
    headers: {
      // Per traveller, so no shared cache may hand one of them another's theme,
      // and revalidated on every launch so a toggle is picked up rather than
      // waiting out an expiry.
      'Cache-Control': 'private, no-cache, must-revalidate',
      'Content-Type': 'application/manifest+json',
      Vary: 'Cookie',
    },
  });
}
