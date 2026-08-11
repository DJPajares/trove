import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type CanonicalPlace = {
  id: string;
  kind: 'custom' | 'provider';
  location: { latitude: number; longitude: number; timeZone: string | null } | null;
  name: string | null;
  note: string | null;
  providerRefs: Array<{ externalPlaceId: string; provider: 'google' }>;
};

export type SavedPlace = {
  collections: Array<{ id: string; name: string }>;
  createdAt: string;
  id: string;
  note: string | null;
  place: CanonicalPlace;
};

export type SavedCollection = {
  id: string;
  name: string;
  placeCount: number;
};

export type ProviderSuggestion = {
  category:
    'destination' | 'food_and_drink' | 'other' | 'shopping' | 'stay' | 'things_to_do' | 'transport';
  description: string | null;
  externalPlaceId: string;
  name: string;
  provider: 'google';
};

export type ProviderPlaceDetails = {
  category: ProviderSuggestion['category'];
  formattedAddress: string | null;
  name: string;
};

type CachedProviderPlaceDetails = ProviderPlaceDetails & {
  cachedAt: number;
};

type ProviderSearchResult =
  { status: 'empty' | 'ok'; suggestions: ProviderSuggestion[] } | { status: 'unavailable' };

export class SavedApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';
const PROVIDER_DETAILS_CACHE_KEY = 'trove.provider-place-details';
const PROVIDER_DETAILS_CACHE_TTL_MS = 60 * 60 * 1_000;
export const GOOGLE_PLACES_SEARCH_DEBOUNCE_MS = 600;

function readProviderDetailsCache() {
  if (typeof window === 'undefined') return {} as Record<string, CachedProviderPlaceDetails>;
  try {
    return JSON.parse(window.sessionStorage.getItem(PROVIDER_DETAILS_CACHE_KEY) ?? '{}') as Record<
      string,
      CachedProviderPlaceDetails
    >;
  } catch {
    return {} as Record<string, CachedProviderPlaceDetails>;
  }
}

export function getCachedProviderPlaceDetails(placeId: string) {
  const entry = readProviderDetailsCache()[placeId];
  if (!entry || Date.now() - entry.cachedAt > PROVIDER_DETAILS_CACHE_TTL_MS) return null;
  const { cachedAt: _cachedAt, ...details } = entry;
  return details;
}

export function cacheProviderPlaceDetails(placeId: string, details: ProviderPlaceDetails) {
  if (typeof window === 'undefined') return;
  const cache = readProviderDetailsCache();
  cache[placeId] = { ...details, cachedAt: Date.now() };
  try {
    window.sessionStorage.setItem(PROVIDER_DETAILS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // The UI can fall back to provider details when session storage is unavailable.
  }
}

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new SavedApiError('supabase_not_configured', 500);

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new SavedApiError('not_authenticated', 401);

  return { accessToken: data.session.access_token };
}

async function savedRequest<T>(path: string, init?: RequestInit) {
  const { accessToken } = await getAuthContext();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new SavedApiError(
      body.code ?? `saved_request_failed_${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchSavedPlaces() {
  return savedRequest<{ collections: SavedCollection[]; savedPlaces: SavedPlace[] }>('/saved');
}

export function saveCanonicalPlace(placeId: string) {
  return savedRequest<{ savedPlace: SavedPlace }>('/saved', {
    body: JSON.stringify({ placeId }),
    method: 'POST',
  });
}

export function unsavePlace(savedPlaceId: string) {
  return savedRequest<void>(`/saved/${savedPlaceId}`, { method: 'DELETE' });
}

export function updateSavedPlaceNote(savedPlaceId: string, note: string | null) {
  return savedRequest<{ savedPlace: SavedPlace }>(`/saved/${savedPlaceId}`, {
    body: JSON.stringify({ note }),
    method: 'PATCH',
  });
}

export function createCollection(name: string) {
  return savedRequest<{ collection: SavedCollection }>('/saved/collections', {
    body: JSON.stringify({ name }),
    method: 'POST',
  });
}

export function renameCollection(collectionId: string, name: string) {
  return savedRequest<{ collection: SavedCollection }>(`/saved/collections/${collectionId}`, {
    body: JSON.stringify({ name }),
    method: 'PATCH',
  });
}

export function removeCollection(collectionId: string) {
  return savedRequest<void>(`/saved/collections/${collectionId}`, { method: 'DELETE' });
}

export function addToCollection(savedPlaceId: string, collectionId: string) {
  return savedRequest<void>(`/saved/${savedPlaceId}/collections/${collectionId}`, {
    method: 'PUT',
  });
}

export function removeFromCollection(savedPlaceId: string, collectionId: string) {
  return savedRequest<void>(`/saved/${savedPlaceId}/collections/${collectionId}`, {
    method: 'DELETE',
  });
}

export function searchProviderPlaces(input: string, signal?: AbortSignal) {
  return savedRequest<ProviderSearchResult>('/places/search', {
    body: JSON.stringify({ input }),
    method: 'POST',
    signal,
  });
}

export function getProviderPlaceDetails(externalPlaceId: string) {
  return savedRequest<{
    place?: ProviderPlaceDetails;
    status: 'empty' | 'ok' | 'unavailable';
  }>(`/places/${encodeURIComponent(externalPlaceId)}`);
}

export function resolveProviderPlace(externalPlaceId: string) {
  return savedRequest<{ place: CanonicalPlace }>('/places/resolve', {
    body: JSON.stringify({ externalPlaceId, provider: 'google' }),
    method: 'POST',
  });
}

export function createCustomPlace(input: { name: string; note?: string | null }) {
  return savedRequest<{ place: CanonicalPlace }>('/places/custom', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}
