import type { TrovePlaceCategory } from '@/lib/place-categories';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/**
 * The provider's own durable answer for a Place, stored by Trove and served
 * from its database. Optional so an itinerary cached in IndexedDB before this
 * existed still renders — the fallbacks below it take over when it is absent.
 */
export type PlaceSnapshot = {
  address: string | null;
  category: TrovePlaceCategory;
  /** When the provider answered, so a surface can date what it shows. */
  fetchedAt: string;
  googleMapsUri: string | null;
  languageCode: string;
  name: string | null;
  primaryType: string | null;
  rawTypes: string[];
  /** Past its permitted life and the refresh could not be made. */
  stale: boolean;
  utcOffsetMinutes: number | null;
};

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
  snapshot?: PlaceSnapshot | null;
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
  placeCount: number;
};

export type ProviderSuggestion = {
  category: TrovePlaceCategory;
  description: string | null;
  externalPlaceId: string;
  name: string;
  provider: 'google';
};

export type ProviderSearchResult =
  | {
      sessionToken: string;
      status: 'empty' | 'ok';
      suggestions: ProviderSuggestion[];
    }
  | { sessionToken: string; status: 'unavailable' };

export class SavedApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';
export const GOOGLE_PLACES_SEARCH_DEBOUNCE_MS = 600;

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

export type SavedPlacesResponse = {
  collections: SavedCollection[];
  savedPlaces: SavedPlace[];
};

export function fetchSavedPlaces() {
  return savedRequest<SavedPlacesResponse>('/saved');
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

/**
 * Resolving is where a Place costs a provider request — once, here, and never
 * again from a screen. The response already carries the snapshot every surface
 * renders from afterwards.
 *
 * The label is what the traveller saw when they picked this Place. It is kept
 * only so the Place still has a name on a day the provider cannot be reached.
 */
export function resolveProviderPlace(
  externalPlaceId: string,
  label?: { address?: string | null; name?: string | null },
  languageCode?: string,
  sessionToken?: string,
) {
  return savedRequest<{ place: CanonicalPlace }>('/places/resolve', {
    body: JSON.stringify({
      externalPlaceId,
      label,
      languageCode,
      provider: 'google',
      sessionToken,
    }),
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
