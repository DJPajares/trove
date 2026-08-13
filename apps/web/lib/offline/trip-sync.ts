import { createBrowserSupabaseClient } from '@/lib/supabase/client';

import {
  getRememberedOfflineUser,
  listUserMutations,
  mergeQueuedMutations,
  type OfflineMutation,
  type OfflineMutationOperation,
  putOfflineMutation,
  readTripSnapshot,
  rememberOfflineUser,
  removeOfflineMutation,
  saveItinerarySnapshot,
  setOfflineApiReachable,
} from './trip-store';
import type { Itinerary, ItineraryItem } from '../itinerary/api';

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

export class OfflineSyncError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function getOfflineAuthContext() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new OfflineSyncError('supabase_not_configured');
  const { data, error } = await supabase.auth.getSession();
  if (!error && data.session) {
    rememberOfflineUser(data.session.user.id);
    return {
      accessToken: data.session.access_token,
      userId: data.session.user.id,
    };
  }
  const rememberedUser = !navigator.onLine ? getRememberedOfflineUser() : null;
  if (rememberedUser) return { accessToken: null, userId: rememberedUser };
  throw new OfflineSyncError('not_authenticated');
}

function findItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    const item = day.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return itinerary.unscheduledItems.find((candidate) => candidate.id === itemId) ?? null;
}

function scheduleFields(item: ItineraryItem) {
  return {
    dayPart: item.dayPart,
    localStartTime: item.localStartTime,
  };
}

function operationAlreadyApplied(
  operation: OfflineMutationOperation,
  current: ItineraryItem | null,
) {
  if (operation.kind === 'itinerary_item_create') return Boolean(current);
  if (operation.kind === 'itinerary_item_delete') return current === null;
  if (!current) return false;
  if (operation.kind === 'itinerary_travel_status') {
    return current.travelStatus === operation.travelStatus;
  }
  if (operation.kind === 'itinerary_item_organize') {
    if (current.itineraryDayId !== operation.input.itineraryDayId) return false;
    return operation.input.position >= 999 || current.position === operation.input.position;
  }
  const input = operation.input;
  const comparisons: boolean[] = [];
  if (input.schedule) {
    const desired =
      input.schedule.kind === 'exact'
        ? { dayPart: null, localStartTime: input.schedule.localTime }
        : {
            dayPart: input.schedule.kind === 'day_part' ? input.schedule.dayPart : null,
            localStartTime: null,
          };
    comparisons.push(JSON.stringify(scheduleFields(current)) === JSON.stringify(desired));
  }
  const fields = ['customLabel', 'durationMinutes', 'notes', 'plannedCost', 'priority'] as const;
  for (const field of fields) {
    if (input[field] !== undefined) {
      comparisons.push(JSON.stringify(current[field]) === JSON.stringify(input[field]));
    }
  }
  if (input.customLocation !== undefined) {
    const desired = input.customLocation
      ? { label: input.customLocation.label, timeZone: input.customLocation.timeZone ?? null }
      : null;
    comparisons.push(JSON.stringify(current.customLocation) === JSON.stringify(desired));
  }
  if (input.tripPlaceId !== undefined) {
    comparisons.push(
      current.tripPlace?.id === input.tripPlaceId || (!current.tripPlace && !input.tripPlaceId),
    );
  }
  return comparisons.length > 0 && comparisons.every(Boolean);
}

function operationConflicts(operation: OfflineMutationOperation, current: ItineraryItem | null) {
  if (operation.kind === 'itinerary_item_create') return false;
  if (operation.kind === 'itinerary_item_delete') {
    return current !== null && current.updatedAt !== operation.baseItem.updatedAt;
  }
  if (!current) return true;
  if (operation.kind === 'itinerary_travel_status') {
    return current.travelStatus !== operation.baseItem.travelStatus;
  }
  if (operation.kind === 'itinerary_item_organize') {
    return (
      current.itineraryDayId !== operation.baseItem.itineraryDayId ||
      current.position !== operation.baseItem.position
    );
  }

  const input = operation.input;
  if (
    input.schedule &&
    JSON.stringify(scheduleFields(current)) !== JSON.stringify(scheduleFields(operation.baseItem))
  ) {
    return true;
  }
  const fields = [
    'customLabel',
    'customLocation',
    'durationMinutes',
    'notes',
    'plannedCost',
    'priority',
  ] as const;
  if (
    fields.some(
      (field) =>
        input[field] !== undefined &&
        JSON.stringify(current[field]) !== JSON.stringify(operation.baseItem[field]),
    )
  ) {
    return true;
  }
  return (
    input.tripPlaceId !== undefined && current.tripPlace?.id !== operation.baseItem.tripPlace?.id
  );
}

function requestFor(
  operation: OfflineMutationOperation,
  tripId: string,
  expectedUpdatedAt?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expectedUpdatedAt) headers['X-Trove-Expected-Updated-At'] = expectedUpdatedAt;

  if (operation.kind === 'itinerary_item_create') {
    return {
      body: JSON.stringify({ ...operation.input, clientItemId: operation.clientItemId }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/itinerary/items`,
    };
  }
  if (operation.kind === 'itinerary_item_delete') {
    return {
      headers,
      method: 'DELETE',
      path: `/trips/${tripId}/itinerary/items/${operation.itemId}`,
    };
  }
  if (operation.kind === 'itinerary_item_organize') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/itinerary/items/${operation.itemId}/organization`,
    };
  }
  if (operation.kind === 'itinerary_item_update') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/itinerary/items/${operation.itemId}`,
    };
  }
  return {
    body: JSON.stringify({ travelStatus: operation.travelStatus }),
    headers,
    method: 'PATCH',
    path: `/trips/${tripId}/itinerary/items/${operation.itemId}/travel-status`,
  };
}

async function apiRequest(
  accessToken: string,
  request: ReturnType<typeof requestFor> | { method: 'GET'; path: string },
) {
  try {
    const response = await fetch(`${apiUrl}${request.path}`, {
      ...request,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...('headers' in request ? request.headers : {}),
      },
    });
    setOfflineApiReachable(response.status < 500);
    return response;
  } catch (error) {
    setOfflineApiReachable(false);
    throw error;
  }
}

async function fetchServerItinerary(accessToken: string, tripId: string) {
  const response = await apiRequest(accessToken, {
    method: 'GET',
    path: `/trips/${tripId}/itinerary`,
  });
  if (!response.ok) throw new OfflineSyncError(`itinerary_request_failed_${response.status}`);
  return response.json() as Promise<Itinerary>;
}

async function updateMutationState(
  mutation: OfflineMutation,
  state: OfflineMutation['state'],
  errorCode: string,
) {
  await putOfflineMutation({
    ...mutation,
    attempts: mutation.attempts + 1,
    errorCode,
    state,
    updatedAt: new Date().toISOString(),
  });
}

async function replayMutation(mutation: OfflineMutation, accessToken: string, force: boolean) {
  const serverItinerary = await fetchServerItinerary(accessToken, mutation.tripId);
  const itemId =
    mutation.operation.kind === 'itinerary_item_create'
      ? mutation.operation.clientItemId
      : mutation.operation.itemId;
  const current = findItem(serverItinerary, itemId);

  if (operationAlreadyApplied(mutation.operation, current)) {
    await removeOfflineMutation(mutation.id);
    return;
  }
  if (!force && operationConflicts(mutation.operation, current)) {
    await updateMutationState(
      mutation,
      'conflict',
      current ? 'itinerary_item_conflict' : 'itinerary_item_missing',
    );
    return;
  }

  const response = await apiRequest(
    accessToken,
    requestFor(mutation.operation, mutation.tripId, current?.updatedAt),
  );
  if (
    response.ok ||
    (response.status === 404 && mutation.operation.kind === 'itinerary_item_delete')
  ) {
    await removeOfflineMutation(mutation.id);
    return;
  }
  if (response.status === 409) {
    await updateMutationState(mutation, 'conflict', 'itinerary_item_conflict');
    return;
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  await updateMutationState(
    mutation,
    'failed',
    body.code ?? `itinerary_request_failed_${response.status}`,
  );
}

async function refreshSnapshot(accessToken: string, userId: string, tripId: string) {
  const server = await fetchServerItinerary(accessToken, tripId);
  const merged = await mergeQueuedMutations(userId, tripId, server);
  await saveItinerarySnapshot(userId, tripId, merged);
}

export async function syncOfflineMutations(options: { mutationId?: string; force?: boolean } = {}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const { accessToken, userId } = await getOfflineAuthContext();
  if (!accessToken) return;
  const mutations = await listUserMutations(userId);
  const selected = options.mutationId
    ? mutations.filter((mutation) => mutation.id === options.mutationId)
    : mutations.filter((mutation) => mutation.state === 'pending');
  const touchedTrips = new Set<string>();

  for (const mutation of selected) {
    touchedTrips.add(mutation.tripId);
    try {
      await replayMutation(mutation, accessToken, options.force ?? false);
    } catch (error) {
      if (error instanceof TypeError) return;
      await updateMutationState(
        mutation,
        'failed',
        error instanceof OfflineSyncError ? error.code : 'offline_sync_failed',
      );
    }
  }

  for (const tripId of touchedTrips) {
    try {
      await refreshSnapshot(accessToken, userId, tripId);
    } catch {
      // The optimistic snapshot remains valid until the next successful refresh.
    }
  }
}

export async function retryOfflineMutation(id: string, keepLocal = false) {
  const { userId } = await getOfflineAuthContext();
  const mutation = (await listUserMutations(userId)).find((candidate) => candidate.id === id);
  if (!mutation) return;
  await putOfflineMutation({
    ...mutation,
    errorCode: null,
    state: 'pending',
    updatedAt: new Date().toISOString(),
  });
  await syncOfflineMutations({ force: keepLocal, mutationId: id });
}

export async function discardOfflineMutation(id: string) {
  const { accessToken, userId } = await getOfflineAuthContext();
  if (!accessToken) throw new OfflineSyncError('not_authenticated');
  const mutation = (await listUserMutations(userId)).find((candidate) => candidate.id === id);
  if (!mutation) return;
  await removeOfflineMutation(id);
  await refreshSnapshot(accessToken, userId, mutation.tripId);
}

export async function getPreparedTripSnapshot(tripId: string) {
  const { userId } = await getOfflineAuthContext();
  return readTripSnapshot(userId, tripId);
}
