import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import { hasProviderPlaceDetailsLocation } from './provider-details-cache';

export type CanonicalPlace = {
  id: string;
  kind: 'custom' | 'provider';
  location: { latitude: number; longitude: number; timeZone: string | null } | null;
  name: string | null;
  note: string | null;
  /** The address the provider gave when this Place was first resolved. */
  providerAddress: string | null;
  /** The name the provider gave then, used only when live details are out of reach. */
  providerLabel: string | null;
  providerRefs: Array<{ externalPlaceId: string; provider: 'google' }>;
};

/**
 * Points straight at the provider's own listing for this exact Place, so it
 * replaces the in-app detail sheet at zero provider cost. `null` for a Place
 * with no Google reference (a custom Place) — callers hide the action then,
 * rather than linking to an ambiguous coordinate search.
 */
export function googleMapsPlaceHref(place: { providerRefs: Array<{ externalPlaceId: string }> }) {
  const providerId = place.providerRefs[0]?.externalPlaceId;
  return providerId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(providerId)}`
    : null;
}

/**
 * For surfaces that only have coordinates in hand (a map pin), not a Place
 * reference. Zero provider cost, same as `googleMapsPlaceHref`.
 */
export function googleMapsCoordinatesHref(location: { latitude: number; longitude: number }) {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

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
  nationalPhoneNumber?: string | null;
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
  googleMapsUri?: string | null;
  location: { latitude: number; longitude: number } | null;
  name: string;
  nationalPhoneNumber?: string | null;
  photos?: Array<{
    authorAttributions: Array<{ displayName: string; photoUri: string | null; uri: string | null }>;
    heightPx: number | null;
    name: string;
    widthPx: number | null;
  }>;
  primaryType?: string | null;
  rating?: number | null;
  regularOpeningHours?: string[];
  userRatingCount?: number | null;
  websiteUri?: string | null;
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

/**
 * The app only ever asks the provider for `location`: a name, an address and
 * coordinates, everything a list, a marker or a route label needs. There is
 * only one cache tier because there is only one detail level requested.
 */
export function getCachedProviderPlaceDetails(placeId: string) {
  const cache = readProviderDetailsCache();
  const entry = cache[placeId];
  if (
    !entry ||
    Date.now() - entry.cachedAt > PROVIDER_DETAILS_CACHE_TTL_MS ||
    !hasProviderPlaceDetailsLocation(entry)
  ) {
    return null;
  }
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
      // A JSON content type with no body makes Fastify reject the request, so this
      // is declared only when the request actually carries one.
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
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

export type ProviderPlaceDetailsResult =
  | { code?: string; status: 'unavailable' }
  | { place?: ProviderPlaceDetails; status: 'empty' | 'ok' };

/**
 * The API answers a Place it cannot resolve with 404 and one it cannot reach with
 * 5xx, both of which `savedRequest` throws. They are caught here and handed back as
 * the statuses the caller already expects, so "Google has nothing for this Place"
 * stays distinguishable from "we could not ask" instead of collapsing into a throw.
 */
export async function getProviderPlaceDetails(
  externalPlaceId: string,
  languageCode?: string,
): Promise<ProviderPlaceDetailsResult> {
  try {
    const query = new URLSearchParams({ detail: 'location' });
    if (languageCode) query.set('languageCode', languageCode);
    return await savedRequest<ProviderPlaceDetailsResult>(
      `/places/${encodeURIComponent(externalPlaceId)}?${query.toString()}`,
    );
  } catch (cause) {
    if (cause instanceof SavedApiError) {
      return cause.status === 404
        ? { status: 'empty' }
        : { code: cause.code, status: 'unavailable' };
    }
    throw cause;
  }
}

/**
 * The label is what the traveller saw when they picked this Place. It is kept only
 * so the Place still has a name on a day the provider cannot be reached.
 */
export function resolveProviderPlace(
  externalPlaceId: string,
  label?: { address?: string | null; name?: string | null },
) {
  return savedRequest<{ place: CanonicalPlace }>('/places/resolve', {
    body: JSON.stringify({ externalPlaceId, label, provider: 'google' }),
    method: 'POST',
  });
}

export function createCustomPlace(input: { name: string; note?: string | null }) {
  return savedRequest<{ place: CanonicalPlace }>('/places/custom', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

/**
 * A custom Place belongs to the traveller who made it, so renaming it changes the
 * Place itself rather than only what one trip calls it.
 */
export function updateCustomPlace(placeId: string, input: { name?: string; note?: string | null }) {
  return savedRequest<{ place: CanonicalPlace }>(`/places/custom/${placeId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}
