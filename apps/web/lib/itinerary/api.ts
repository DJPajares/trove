import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type ItineraryDayPart = 'afternoon' | 'anytime' | 'evening' | 'morning';
export type ItineraryPriority = 'interested' | 'maybe' | 'must_go';
export type ItineraryScheduleInput =
  | { kind: 'none' }
  | { dayPart: ItineraryDayPart; kind: 'day_part' }
  | { kind: 'exact'; localTime: string };

export type ItineraryTripPlace = {
  id: string;
  place: {
    id: string;
    kind: 'custom' | 'provider';
    name: string | null;
    providerRefs: Array<{ externalPlaceId: string; provider: 'google' }>;
    timeZone: string | null;
  };
};

export type ItineraryItem = {
  createdAt: string;
  customLabel: string | null;
  customLocation: { label: string; timeZone: string | null } | null;
  dayPart: ItineraryDayPart | null;
  durationMinutes: number | null;
  id: string;
  itineraryDayId: string | null;
  localStartTime: string | null;
  notes: string | null;
  plannedCost: { amount: string; currencyCode: string } | null;
  position: number;
  priority: ItineraryPriority | null;
  startInstant: string | null;
  timeSemantics: 'authoritative_instant' | 'floating_local' | null;
  timeZone: string | null;
  timeZoneSource: 'day_default' | 'explicit' | 'place' | null;
  tripPlace: ItineraryTripPlace | null;
  updatedAt: string;
};

export type ItineraryDay = {
  dailyBaseTripPlaceId: string | null;
  date: string;
  defaultTimeZone: string;
  defaultTimeZoneSource:
    'accommodation' | 'explicit_daily_base' | 'first_located_item' | 'trip_reference';
  id: string;
  items: ItineraryItem[];
  notes: string | null;
};

export type Itinerary = {
  days: ItineraryDay[];
  trip: {
    endDate: string;
    id: string;
    name: string;
    referenceTimeZone: string;
    startDate: string;
  };
  tripPlaces: ItineraryTripPlace[];
  unscheduledItems: ItineraryItem[];
};

export type ItineraryItemInput = {
  customLabel?: string | null;
  customLocation?: { label: string; timeZone?: string | null } | null;
  durationMinutes?: number | null;
  itineraryDayId?: string;
  notes?: string | null;
  plannedCost?: { amount: string; currencyCode: string } | null;
  priority?: ItineraryPriority | null;
  schedule?: ItineraryScheduleInput;
  tripPlaceId?: string | null;
};

export class ItineraryApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new ItineraryApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ItineraryApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function itineraryRequest<T>(path: string, init?: RequestInit) {
  const accessToken = await getAccessToken();
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
    throw new ItineraryApiError(
      body.code ?? `itinerary_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchItinerary(tripId: string) {
  return itineraryRequest<Itinerary>(`/trips/${tripId}/itinerary`);
}

export function createItineraryItem(tripId: string, input: ItineraryItemInput) {
  return itineraryRequest<{ item: ItineraryItem }>(`/trips/${tripId}/itinerary/items`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateItineraryItem(tripId: string, itemId: string, input: ItineraryItemInput) {
  return itineraryRequest<{
    item: ItineraryItem;
    timeZoneConsequence: {
      kind: 'derived_instant_changed';
      previousStartInstant: string;
      startInstant: string;
    } | null;
  }>(`/trips/${tripId}/itinerary/items/${itemId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteItineraryItem(tripId: string, itemId: string) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/items/${itemId}`, {
    method: 'DELETE',
  });
}

export function organizeItineraryItem(
  tripId: string,
  itemId: string,
  input: { itineraryDayId: string | null; position: number },
) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/items/${itemId}/organization`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function duplicateItineraryItem(tripId: string, itemId: string) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/items/${itemId}/duplicate`, {
    method: 'POST',
  });
}

export function setItineraryDayBase(
  tripId: string,
  itineraryDayId: string,
  tripPlaceId: string | null,
) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/days/${itineraryDayId}/base`, {
    body: JSON.stringify({ tripPlaceId }),
    method: 'PATCH',
  });
}
