import type { AtlasGuide } from '@trove/types';

import { authenticatedFetch, getProtectedSession } from '@/lib/auth/transport';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class AtlasApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

/** One country's guide, adapted from Wikivoyage and stored by the API. */
export async function fetchAtlasGuide(countryCode: string): Promise<AtlasGuide> {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new AtlasApiError('supabase_not_configured', 500);
  const { data, error } = await getProtectedSession(supabase);
  if (error || !data.session) throw new AtlasApiError('not_authenticated', 401);

  const response = await authenticatedFetch(
    `${apiUrl}/atlas/guides/${encodeURIComponent(countryCode)}`,
    { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new AtlasApiError(
      body.code ?? `atlas_request_failed_${response.status}`,
      response.status,
    );
  }
  return ((await response.json()) as { guide: AtlasGuide }).guide;
}
