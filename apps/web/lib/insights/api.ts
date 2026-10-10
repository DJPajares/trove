import type { TripContext } from '@trove/types';

import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export class TripContextApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Holidays and typical conditions for a trip's days, for Insights. */
export async function fetchTripContext(
  tripId: string,
  options: { languageCode: string; signal?: AbortSignal },
) {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new TripContextApiError('supabase_not_configured', 500);

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new TripContextApiError('not_authenticated', 401);

  const query = new URLSearchParams({ languageCode: options.languageCode });
  const response = await fetch(`${apiUrl}/trips/${tripId}/context?${query}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new TripContextApiError(
      body.code ?? `trip_context_request_failed_${response.status}`,
      response.status,
    );
  }

  return (await response.json()) as TripContext;
}
