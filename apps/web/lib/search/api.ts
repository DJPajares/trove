import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type SearchResultKind =
  'note' | 'reservation' | 'saved_place' | 'trip' | 'trip_info' | 'trip_place';
export type SearchNoteSource =
  'itinerary' | 'reservation' | 'saved_place' | 'trip' | 'trip_info' | 'trip_place';

export type TroveSearchResult = {
  description: string | null;
  href: string;
  id: string;
  kind: SearchResultKind;
  noteSource: SearchNoteSource | null;
  title: string;
  trip: { id: string; name: string } | null;
};

export type SearchResponse = {
  canSearchPlaces: boolean;
  external: {
    results: Array<{
      description: string | null;
      externalPlaceId: string;
      href: string;
      name: string;
      provider: 'google';
    }>;
    status: 'empty' | 'not_requested' | 'ok' | 'unavailable';
  };
  groups: Array<{ kind: SearchResultKind; results: TroveSearchResult[] }>;
  query: string;
};

export class SearchApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

export async function searchTrove(
  query: string,
  options: { includePlaces?: boolean; signal?: AbortSignal } = {},
) {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new SearchApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new SearchApiError('not_authenticated', 401);

  const parameters = new URLSearchParams({ q: query });
  if (options.includePlaces) parameters.set('places', '1');

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/search?${parameters}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      signal: options.signal,
    });
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === 'AbortError') {
      throw requestError;
    }
    throw new SearchApiError('search_unavailable', 503);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new SearchApiError(
      body.code ?? `search_request_failed_${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<SearchResponse>;
}
