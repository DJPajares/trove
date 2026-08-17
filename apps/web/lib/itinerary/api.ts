import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  applyMutationToStoredItinerary,
  getRememberedOfflineUser,
  mergeQueuedMutations,
  type OfflineItineraryMutationOperation,
  type OfflineMutation,
  type OfflineMutationOperation,
  queueOfflineMutation,
  readTripSnapshot,
  rememberOfflineUser,
  saveItinerarySnapshot,
  saveSupportingSnapshot,
  setOfflineApiReachable,
} from '@/lib/offline/trip-store';

export type ItineraryDayPart = 'afternoon' | 'anytime' | 'evening' | 'morning';
export type ItineraryPriority = 'interested' | 'maybe' | 'must_go';
export type ItineraryTravelStatus = 'completed' | 'skipped' | 'upcoming';
export type RouteTravelMode = 'drive' | 'flight' | 'transit' | 'walk';
export type ItineraryScheduleInput =
  | { kind: 'none' }
  | { dayPart: ItineraryDayPart; kind: 'day_part' }
  | { kind: 'exact'; localTime: string };

export type ItineraryTripPlace = {
  customName: string | null;
  id: string;
  note: string | null;
  place: {
    id: string;
    kind: 'custom' | 'provider';
    location: { latitude: number; longitude: number; timeZone: string | null } | null;
    name: string | null;
    note: string | null;
    providerAddress: string | null;
    providerLabel: string | null;
    providerRefs: Array<{ externalPlaceId: string; provider: 'google'; resolvedAt?: string }>;
    timeZone: string | null;
  };
  priority: ItineraryPriority | null;
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
  travelModeToNext?: RouteTravelMode;
  travelStatus: ItineraryTravelStatus;
  tripPlace: ItineraryTripPlace | null;
  updatedAt: string;
};

export type ItineraryDay = {
  dailyBaseDepartureTripPlaceId: string | null;
  dailyBaseTripPlaceId: string | null;
  date: string;
  defaultTimeZone: string;
  defaultTimeZoneSource:
    'accommodation' | 'explicit_daily_base' | 'first_located_item' | 'trip_reference';
  defaultTimeZoneSourceTripPlaceId: string | null;
  experienceNote: string | null;
  experienceRating: number | null;
  id: string;
  items: ItineraryItem[];
  notes: string | null;
  routeStartTravelMode: RouteTravelMode;
};

export type ItineraryRouteSegment = {
  destination: {
    id: string;
    kind: 'daily_base' | 'itinerary_item' | 'starting_location';
    label: string | null;
  };
  distanceMeters: number | null;
  durationSeconds: number | null;
  encodedPolyline: string | null;
  id: string;
  mode: RouteTravelMode;
  modeOwner: { id: string; kind: 'day_start' | 'item_departure' };
  origin: {
    id: string;
    kind: 'daily_base' | 'itinerary_item' | 'starting_location';
    label: string | null;
  };
  provider: 'google' | null;
  reason: string | null;
  /** `long_distance` legs are never routed and are excluded from the day's totals. */
  scope: 'local' | 'long_distance';
  /** `not_estimated` is a deliberate absence of an estimate, not a failure to get one. */
  status: 'not_estimated' | 'ok' | 'unavailable';
};

export type ItineraryDayRoutes = {
  generatedAt: string;
  source?: 'cache' | 'live';
  stale?: boolean;
  segments: ItineraryRouteSegment[];
  summary: {
    distanceMeters: number | null;
    durationSeconds: number | null;
    knownSegmentCount: number;
    /** Legs the totals describe. Zero alongside legs means the day only moves long distance. */
    localSegmentCount: number;
    scheduledPlaceCount: number;
    status: 'complete' | 'partial' | 'unavailable';
    totalSegmentCount: number;
  };
};

export type SuggestedTimeReasonCode =
  | 'AFTER_PREVIOUS_ITEM'
  | 'BEFORE_FIXED_ITEM'
  | 'CLEARS_COMMITMENT'
  | 'DAY_PART_WINDOW'
  | 'DAY_START'
  | 'OPENING_HOURS';

export type SuggestedTimeCaveat = 'DURATION_UNKNOWN' | 'OPENING_HOURS_UNKNOWN' | 'TRAVEL_UNKNOWN';

/** Mirrors the editor's schedule choices, including ones still unsaved. */
export type RequestedSchedule = 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';

/**
 * The server sends codes and item ids only; the client owns the wording, the
 * same convention Plan Score explanations follow.
 */
export type ItineraryDayTimeSuggestion = {
  itemId: string;
  /** Day-local `HH:MM`, ready for the exact-time field. Null unless status is ok. */
  localTime: string | null;
} & (
  | { caveats: SuggestedTimeCaveat[]; reasons: SuggestedTimeReason[]; status: 'ok' }
  | { blockedBy: SuggestedTimeReasonCode[]; status: 'no_feasible_time' }
  | { missing: SuggestedTimeCaveat[]; status: 'insufficient_evidence' }
);

export type SuggestedTimeReason = {
  code: SuggestedTimeReasonCode;
  references: string[];
};

export type ItineraryDayTimeSuggestions = {
  generatedAt: string;
  itineraryDayId: string;
  suggestions: ItineraryDayTimeSuggestion[];
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

export type TripModeContext = {
  contextAt: string;
  contextSource: 'live' | 'preview';
  currentOrRelevant: {
    itemId: string;
    kind: 'current' | 'relevant';
    reason: 'day_part' | 'exact_time' | 'itinerary_order' | 'overdue';
  } | null;
  day: {
    date: string;
    defaultTimeZone: string;
    id: string;
    items: ItineraryItem[];
  } | null;
  leaveBy: {
    at: string;
    bufferSeconds: number | null;
    destinationItemId: string;
    distanceMeters: number | null;
    mode: RouteTravelMode;
    originItemId: string;
    provider: 'google' | null;
    routeDurationSeconds: number;
    targetStartAt: string;
  } | null;
  nextItemId: string | null;
  selectedDate: string;
  state: 'current' | 'free_time' | 'no_day' | 'no_next_item' | 'relevant';
  trip: {
    endDate: string;
    id: string;
    name: string;
    referenceTimeZone: string;
    startDate: string;
  };
};

export type TripModeContextRequestOptions =
  | { at: string; date?: never; signal?: AbortSignal; time?: never }
  | { at?: never; date: string; signal?: AbortSignal; time: string }
  | { at?: never; date?: never; signal?: AbortSignal; time?: never };

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

async function getAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new ItineraryApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (!error && data.session) {
    rememberOfflineUser(data.session.user.id);
    return { accessToken: data.session.access_token, userId: data.session.user.id };
  }
  const rememberedUser =
    typeof navigator !== 'undefined' && !navigator.onLine ? getRememberedOfflineUser() : null;
  if (rememberedUser) return { accessToken: null, userId: rememberedUser };
  throw new ItineraryApiError('not_authenticated', 401);
}

async function itineraryRequest<T>(
  path: string,
  init?: RequestInit,
  authContext?: Awaited<ReturnType<typeof getAuthContext>>,
) {
  const { accessToken } = authContext ?? (await getAuthContext());
  if (!accessToken) throw new ItineraryApiError('offline_session', 503);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // A JSON content type with no body makes Fastify reject the request, so this
        // is declared only when the request actually carries one.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      setOfflineApiReachable(false);
    }
    throw error;
  }
  setOfflineApiReachable(response.status < 500);
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

function canUseOfflineFallback(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof ItineraryApiError && error.status >= 500) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
}

function findItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    const item = day.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return itinerary.unscheduledItems.find((candidate) => candidate.id === itemId) ?? null;
}

function localDateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function localTimeInTimeZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone,
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

function localPreviewInstant(date: string, time: string, timeZone: string) {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(new Date(guess));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
    );
    guess += desired - represented;
  }
  return new Date(guess);
}

function minuteOfDay(value: string) {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function dayPartIndex(value: ItineraryDayPart | null) {
  if (value === 'morning') return 0;
  if (value === 'afternoon') return 1;
  if (value === 'evening') return 2;
  return null;
}

function offlineTripModeContext(
  itinerary: Itinerary,
  options: TripModeContextRequestOptions,
): TripModeContext {
  const selectedDate = options.date ?? localDateInTimeZone(itinerary.trip.referenceTimeZone);
  const day = itinerary.days.find((candidate) => candidate.date === selectedDate) ?? null;
  const activeItems = day?.items.filter((item) => item.travelStatus === 'upcoming') ?? [];
  const contextTimeZone = day?.defaultTimeZone ?? itinerary.trip.referenceTimeZone;
  const at = options.date
    ? localPreviewInstant(options.date, options.time, contextTimeZone)
    : options.at
      ? new Date(options.at)
      : new Date();
  const localTime = options.time ?? localTimeInTimeZone(at, contextTimeZone);
  const localMinute = minuteOfDay(localTime);
  const localPart = localMinute < 12 * 60 ? 0 : localMinute < 17 * 60 ? 1 : 2;
  const phases = activeItems.map((item) => {
    if (item.localStartTime) {
      const start = minuteOfDay(item.localStartTime);
      const end = start + (item.durationMinutes ?? 1);
      return localMinute < start ? 'future' : localMinute < end ? 'current' : 'overdue';
    }
    const itemPart = dayPartIndex(item.dayPart);
    if (itemPart === null) return 'flexible';
    return localPart < itemPart ? 'future' : localPart === itemPart ? 'current' : 'overdue';
  });
  const currentIndex = phases.findIndex((phase) => phase === 'current');
  const overdueIndex = phases.findLastIndex((phase) => phase === 'overdue');
  const flexibleIndex = phases.findIndex((phase) => phase === 'flexible');
  const relevantIndex = currentIndex >= 0 ? currentIndex : Math.max(overdueIndex, flexibleIndex);
  const current = relevantIndex >= 0 ? activeItems[relevantIndex] : null;
  const nextIndex = phases.findIndex(
    (phase, index) => index > relevantIndex && (phase === 'future' || phase === 'flexible'),
  );
  const next = nextIndex >= 0 ? activeItems[nextIndex] : null;
  const currentReason = current?.localStartTime
    ? 'exact_time'
    : dayPartIndex(current?.dayPart ?? null) !== null
      ? 'day_part'
      : current
        ? 'itinerary_order'
        : null;
  return {
    contextAt: at.toISOString(),
    contextSource: options.date ? 'preview' : 'live',
    currentOrRelevant:
      current && currentReason
        ? {
            itemId: current.id,
            kind: currentIndex >= 0 ? 'current' : 'relevant',
            reason: currentReason,
          }
        : null,
    day: day
      ? {
          date: day.date,
          defaultTimeZone: day.defaultTimeZone,
          id: day.id,
          items: day.items,
        }
      : null,
    leaveBy: null,
    nextItemId: next?.id ?? null,
    selectedDate,
    state: day
      ? current
        ? currentIndex >= 0
          ? 'current'
          : 'relevant'
        : next
          ? 'free_time'
          : 'no_next_item'
      : 'no_day',
    trip: itinerary.trip,
  };
}

export async function fetchItinerary(tripId: string) {
  const auth = await getAuthContext();
  const snapshot = await readTripSnapshot(auth.userId, tripId).catch(() => undefined);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (snapshot?.itinerary) return snapshot.itinerary;
    throw new ItineraryApiError('offline_trip_not_prepared', 503);
  }
  try {
    const server = await itineraryRequest<Itinerary>(`/trips/${tripId}/itinerary`, undefined, auth);
    const itinerary = await mergeQueuedMutations(auth.userId, tripId, server);
    await saveItinerarySnapshot(auth.userId, tripId, itinerary);
    return itinerary;
  } catch (error) {
    if (canUseOfflineFallback(error) && snapshot?.itinerary) return snapshot.itinerary;
    throw error;
  }
}

export async function fetchTripModeContext(
  tripId: string,
  options: TripModeContextRequestOptions = {},
) {
  const query = new URLSearchParams();
  if (options.at) query.set('at', options.at);
  if (options.date) query.set('date', options.date);
  if (options.time) query.set('time', options.time);
  const suffix = query.size ? `?${query.toString()}` : '';
  try {
    return await itineraryRequest<TripModeContext>(`/trips/${tripId}/trip-mode/context${suffix}`, {
      signal: options.signal,
    });
  } catch (error) {
    if (!canUseOfflineFallback(error)) throw error;
    const auth = await getAuthContext();
    const snapshot = await readTripSnapshot(auth.userId, tripId).catch(() => undefined);
    if (!snapshot?.itinerary) throw error;
    return offlineTripModeContext(snapshot.itinerary, options);
  }
}

export async function fetchItineraryDayRoutes(
  tripId: string,
  itineraryDayId: string,
  options: { includePolyline?: boolean; languageCode?: string; signal?: AbortSignal } = {},
) {
  const query = new URLSearchParams();
  if (options.includePolyline) query.set('includePolyline', 'true');
  if (options.languageCode) query.set('languageCode', options.languageCode);
  const suffix = query.size ? `?${query.toString()}` : '';
  const auth = await getAuthContext();
  const snapshot = await readTripSnapshot(auth.userId, tripId).catch(() => undefined);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = snapshot?.routes?.[itineraryDayId];
    if (cached) return { ...cached, source: 'cache' as const, stale: true };
    throw new ItineraryApiError('offline_route_not_available', 503);
  }
  try {
    const response = await itineraryRequest<ItineraryDayRoutes>(
      `/trips/${tripId}/itinerary/days/${itineraryDayId}/routes${suffix}`,
      { signal: options.signal },
      auth,
    );
    const data = { ...response, source: 'live' as const, stale: false };
    await saveSupportingSnapshot(auth.userId, tripId, 'routes', {
      ...snapshot?.routes,
      [itineraryDayId]: data,
    });
    return data;
  } catch (error) {
    const cached = snapshot?.routes?.[itineraryDayId];
    if (canUseOfflineFallback(error) && cached) {
      return { ...cached, source: 'cache' as const, stale: true };
    }
    throw error;
  }
}

/**
 * Suggested start times for a day.
 *
 * Deliberately has no offline path. The suggestion is derived from live route
 * and provider evidence, so a cached answer would be a stale proposal presented
 * as a current one — the same reason Plan Score never reads the offline
 * snapshot. Callers hide the affordance while offline rather than queueing it;
 * this is a read, and nothing is lost by waiting.
 */
export async function fetchItineraryDayTimeSuggestions(
  tripId: string,
  itineraryDayId: string,
  options: { itemId?: string; schedule?: RequestedSchedule; signal?: AbortSignal } = {},
) {
  const query = new URLSearchParams();
  if (options.itemId) query.set('itemId', options.itemId);
  // Sent so the answer reflects the timing on screen rather than the timing on
  // disk; the editor can ask while a daypart change is still unsaved.
  if (options.schedule) query.set('schedule', options.schedule);
  const suffix = query.size ? `?${query.toString()}` : '';
  const auth = await getAuthContext();

  return itineraryRequest<ItineraryDayTimeSuggestions>(
    `/trips/${tripId}/itinerary/days/${itineraryDayId}/time-suggestions${suffix}`,
    { signal: options.signal },
    auth,
  );
}

function createMutation(
  userId: string,
  tripId: string,
  operation: OfflineMutationOperation,
): OfflineMutation {
  const now = new Date().toISOString();
  return {
    attempts: 0,
    createdAt: now,
    errorCode: null,
    id: crypto.randomUUID(),
    operation,
    state: 'pending',
    tripId,
    updatedAt: now,
    userId,
  };
}

async function queueOrThrow(
  error: unknown,
  userId: string,
  tripId: string,
  operation: OfflineMutationOperation,
) {
  if (!canUseOfflineFallback(error)) throw error;
  await queueOfflineMutation(createMutation(userId, tripId, operation));
}

async function baseItem(userId: string, tripId: string, itemId: string) {
  const snapshot = await readTripSnapshot(userId, tripId);
  const item = snapshot?.itinerary ? findItem(snapshot.itinerary, itemId) : null;
  if (!item) throw new ItineraryApiError('offline_item_not_available', 503);
  return structuredClone(item);
}

async function applyOnlineMutation(
  userId: string,
  tripId: string,
  operation: OfflineItineraryMutationOperation,
) {
  await applyMutationToStoredItinerary(userId, tripId, operation).catch(() => undefined);
}

export async function createItineraryItem(tripId: string, input: ItineraryItemInput) {
  if (!input.itineraryDayId) throw new ItineraryApiError('invalid_itinerary_item', 400);
  const auth = await getAuthContext();
  const clientItemId = crypto.randomUUID();
  const operation: OfflineMutationOperation = {
    clientItemId,
    input: { ...input, itineraryDayId: input.itineraryDayId },
    kind: 'itinerary_item_create',
  };
  try {
    const result = await itineraryRequest<{ item: ItineraryItem }>(
      `/trips/${tripId}/itinerary/items`,
      { body: JSON.stringify({ ...input, clientItemId }), method: 'POST' },
      auth,
    );
    await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    await queueOrThrow(error, auth.userId, tripId, operation);
    const snapshot = await readTripSnapshot(auth.userId, tripId);
    const item = snapshot?.itinerary ? findItem(snapshot.itinerary, clientItemId) : null;
    if (!item) throw error;
    return { item };
  }
}

export async function updateItineraryItem(
  tripId: string,
  itemId: string,
  input: ItineraryItemInput,
) {
  const auth = await getAuthContext();
  const storedBaseItem = await baseItem(auth.userId, tripId, itemId).catch(() => null);
  const operation: OfflineMutationOperation | null = storedBaseItem
    ? {
        baseItem: storedBaseItem,
        input,
        itemId,
        kind: 'itinerary_item_update',
      }
    : null;
  try {
    const result = await itineraryRequest<{
      item: ItineraryItem;
      timeZoneConsequence: {
        kind: 'derived_instant_changed';
        previousStartInstant: string;
        startInstant: string;
      } | null;
    }>(
      `/trips/${tripId}/itinerary/items/${itemId}`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    );
    if (operation) await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    if (!operation) throw error;
    await queueOrThrow(error, auth.userId, tripId, operation);
    const snapshot = await readTripSnapshot(auth.userId, tripId);
    const item = snapshot?.itinerary ? findItem(snapshot.itinerary, itemId) : null;
    if (!item) throw error;
    return { item, timeZoneConsequence: null };
  }
}

export async function deleteItineraryItem(tripId: string, itemId: string) {
  const auth = await getAuthContext();
  const storedBaseItem = await baseItem(auth.userId, tripId, itemId).catch(() => null);
  const operation: OfflineMutationOperation | null = storedBaseItem
    ? {
        baseItem: storedBaseItem,
        itemId,
        kind: 'itinerary_item_delete',
      }
    : null;
  try {
    const result = await itineraryRequest<void>(
      `/trips/${tripId}/itinerary/items/${itemId}`,
      { method: 'DELETE' },
      auth,
    );
    if (operation) await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    if (!operation) throw error;
    await queueOrThrow(error, auth.userId, tripId, operation);
  }
}

export async function organizeItineraryItem(
  tripId: string,
  itemId: string,
  input: { itineraryDayId: string | null; position: number },
) {
  const auth = await getAuthContext();
  const storedBaseItem = await baseItem(auth.userId, tripId, itemId).catch(() => null);
  const operation: OfflineMutationOperation | null = storedBaseItem
    ? {
        baseItem: storedBaseItem,
        input,
        itemId,
        kind: 'itinerary_item_organize',
      }
    : null;
  try {
    const result = await itineraryRequest<void>(
      `/trips/${tripId}/itinerary/items/${itemId}/organization`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    );
    if (operation) await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    if (!operation) throw error;
    await queueOrThrow(error, auth.userId, tripId, operation);
  }
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
  departureTripPlaceId?: string | null,
) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/days/${itineraryDayId}/base`, {
    body: JSON.stringify({
      tripPlaceId,
      ...(departureTripPlaceId !== undefined ? { departureTripPlaceId } : {}),
    }),
    method: 'PATCH',
  });
}

export async function updateItineraryDayNote(
  tripId: string,
  itineraryDayId: string,
  note: string | null,
) {
  const auth = await getAuthContext();
  const snapshot = await readTripSnapshot(auth.userId, tripId).catch(() => undefined);
  const day = snapshot?.itinerary?.days.find((candidate) => candidate.id === itineraryDayId);
  const operation: OfflineItineraryMutationOperation | null = day
    ? { baseNote: day.notes, itineraryDayId, kind: 'itinerary_day_note', note }
    : null;
  try {
    const result = await itineraryRequest<{ id: string; notes: string | null }>(
      `/trips/${tripId}/itinerary/days/${itineraryDayId}/note`,
      { body: JSON.stringify({ note }), method: 'PATCH' },
      auth,
    );
    if (operation) await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    if (!operation) throw error;
    await queueOrThrow(error, auth.userId, tripId, operation);
    return { id: itineraryDayId, notes: note?.trim() || null };
  }
}

/**
 * Experience Rating is the traveller's own private reflection on the day,
 * entered independently of Plan Score and never averaged into the trip rating.
 */
export function updateItineraryDayExperienceRating(
  tripId: string,
  itineraryDayId: string,
  rating: number | null,
  note: string | null,
) {
  return itineraryRequest<{
    experienceNote: string | null;
    experienceRating: number | null;
    id: string;
  }>(`/trips/${tripId}/itinerary/days/${itineraryDayId}/experience-rating`, {
    body: JSON.stringify({ note, rating }),
    method: 'PATCH',
  });
}

export function updateItineraryDayRouteMode(
  tripId: string,
  itineraryDayId: string,
  mode: RouteTravelMode,
) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/days/${itineraryDayId}/route-mode`, {
    body: JSON.stringify({ mode }),
    method: 'PATCH',
  });
}

export function updateItineraryItemRouteMode(
  tripId: string,
  itemId: string,
  mode: RouteTravelMode,
) {
  return itineraryRequest<void>(`/trips/${tripId}/itinerary/items/${itemId}/route-mode`, {
    body: JSON.stringify({ mode }),
    method: 'PATCH',
  });
}

export async function updateItineraryItemTravelStatus(
  tripId: string,
  itemId: string,
  travelStatus: ItineraryTravelStatus,
) {
  const auth = await getAuthContext();
  const storedBaseItem = await baseItem(auth.userId, tripId, itemId).catch(() => null);
  const operation: OfflineMutationOperation | null = storedBaseItem
    ? {
        baseItem: storedBaseItem,
        itemId,
        kind: 'itinerary_travel_status',
        travelStatus,
      }
    : null;
  try {
    const result = await itineraryRequest<{ id: string; travelStatus: ItineraryTravelStatus }>(
      `/trips/${tripId}/itinerary/items/${itemId}/travel-status`,
      { body: JSON.stringify({ travelStatus }), method: 'PATCH' },
      auth,
    );
    if (operation) await applyOnlineMutation(auth.userId, tripId, operation);
    return result;
  } catch (error) {
    if (!operation) throw error;
    await queueOrThrow(error, auth.userId, tripId, operation);
    return { id: itemId, travelStatus };
  }
}
