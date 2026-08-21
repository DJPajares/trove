import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { uploadMemoryPhotoObject } from '@/lib/memories/storage';

import {
  getOfflineMemoryMedia,
  getRememberedOfflineUser,
  listUserMutations,
  mergeQueuedMemories,
  mergeQueuedMutations,
  OFFLINE_DATA_REFRESH_EVENT,
  type OfflineItineraryMutationOperation,
  type OfflineMemoryMutationOperation,
  type OfflineMutation,
  type OfflineMutationOperation,
  type OfflineSupportingMutationOperation,
  putOfflineMutation,
  readTripSnapshot,
  rememberOfflineUser,
  removeOfflineMemoryMedia,
  removeOfflineMutation,
  saveItinerarySnapshot,
  saveSupportingSnapshot,
  setOfflineApiReachable,
} from './trip-store';
import type { Itinerary, ItineraryItem } from '../itinerary/api';
import type { Expense, ExpensesResponse } from '../expenses/api';
import type { MemoriesResponse } from '../memories/api';
import type { Task, TasksResponse } from '../tasks/api';
import type { TripInfoEntry, TripInfoResponse } from '../trip-info/api';

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

function itineraryOperationAlreadyApplied(
  operation: Exclude<
    OfflineItineraryMutationOperation,
    { kind: 'itinerary_day_move' | 'itinerary_day_note' }
  >,
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

function itineraryOperationConflicts(
  operation: Exclude<
    OfflineItineraryMutationOperation,
    { kind: 'itinerary_day_move' | 'itinerary_day_note' }
  >,
  current: ItineraryItem | null,
) {
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

  if (operation.kind === 'itinerary_day_move') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/itinerary/days/${operation.sourceItineraryDayId}/move`,
    };
  }
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
  if (operation.kind === 'itinerary_day_note') {
    return {
      body: JSON.stringify({ note: operation.note }),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/itinerary/days/${operation.itineraryDayId}/note`,
    };
  }
  if (operation.kind === 'task_create') {
    return {
      body: JSON.stringify({ ...operation.input, clientTaskId: operation.clientTaskId }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/tasks`,
    };
  }
  if (operation.kind === 'task_update') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/tasks/${operation.taskId}`,
    };
  }
  if (operation.kind === 'task_delete') {
    return { headers, method: 'DELETE', path: `/trips/${tripId}/tasks/${operation.taskId}` };
  }
  if (operation.kind === 'trip_info_create') {
    return {
      body: JSON.stringify({ ...operation.input, clientEntryId: operation.clientEntryId }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/info`,
    };
  }
  if (operation.kind === 'trip_info_update') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/info/${operation.entryId}`,
    };
  }
  if (operation.kind === 'trip_info_delete') {
    return { headers, method: 'DELETE', path: `/trips/${tripId}/info/${operation.entryId}` };
  }
  if (operation.kind === 'expense_create') {
    return {
      body: JSON.stringify({ ...operation.input, clientExpenseId: operation.clientExpenseId }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/expenses`,
    };
  }
  if (operation.kind === 'expense_update') {
    return {
      body: JSON.stringify(operation.input),
      headers,
      method: 'PATCH',
      path: `/trips/${tripId}/expenses/${operation.expenseId}`,
    };
  }
  if (operation.kind === 'expense_delete') {
    return { headers, method: 'DELETE', path: `/trips/${tripId}/expenses/${operation.expenseId}` };
  }
  if (operation.kind === 'memory_create') {
    return {
      body: JSON.stringify({ ...operation.input, clientMemoryId: operation.clientMemoryId }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/memories`,
    };
  }
  if (operation.kind === 'memory_photo_create') {
    return {
      body: JSON.stringify({
        contentType: operation.contentType,
        fileName: operation.fileName,
        path: operation.path,
        sizeBytes: operation.sizeBytes,
      }),
      headers,
      method: 'POST',
      path: `/trips/${tripId}/memories/${operation.clientMemoryId}/photos`,
    };
  }
  if (operation.kind === 'memory_delete') {
    return { headers, method: 'DELETE', path: `/trips/${tripId}/memories/${operation.memoryId}` };
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

function matchingFields(current: object, input: object) {
  return Object.entries(input).every(
    ([key, value]) =>
      JSON.stringify(current[key as keyof typeof current]) === JSON.stringify(value),
  );
}

async function supportingEntity(
  accessToken: string,
  tripId: string,
  operation: OfflineSupportingMutationOperation,
): Promise<Task | TripInfoEntry | Expense | null> {
  if (
    operation.kind === 'task_create' ||
    operation.kind === 'task_update' ||
    operation.kind === 'task_delete'
  ) {
    const response = await apiRequest(accessToken, {
      method: 'GET',
      path: `/trips/${tripId}/tasks`,
    });
    if (!response.ok) throw new OfflineSyncError(`tasks_request_failed_${response.status}`);
    const data = (await response.json()) as TasksResponse;
    const id = operation.kind === 'task_create' ? operation.clientTaskId : operation.taskId;
    return data.tasks.find((task) => task.id === id) ?? null;
  }
  if (
    operation.kind === 'trip_info_create' ||
    operation.kind === 'trip_info_update' ||
    operation.kind === 'trip_info_delete'
  ) {
    const response = await apiRequest(accessToken, {
      method: 'GET',
      path: `/trips/${tripId}/info`,
    });
    if (!response.ok) throw new OfflineSyncError(`trip_info_request_failed_${response.status}`);
    const data = (await response.json()) as TripInfoResponse;
    const id = operation.kind === 'trip_info_create' ? operation.clientEntryId : operation.entryId;
    return data.entries.find((entry) => entry.id === id) ?? null;
  }
  if (
    operation.kind !== 'expense_create' &&
    operation.kind !== 'expense_update' &&
    operation.kind !== 'expense_delete'
  ) {
    return null;
  }
  const response = await apiRequest(accessToken, {
    method: 'GET',
    path: `/trips/${tripId}/expenses`,
  });
  if (!response.ok) throw new OfflineSyncError(`expenses_request_failed_${response.status}`);
  const data = (await response.json()) as ExpensesResponse;
  const id = operation.kind === 'expense_create' ? operation.clientExpenseId : operation.expenseId;
  return data.expenses.find((expense) => expense.id === id) ?? null;
}

function supportingAlreadyApplied(
  operation: OfflineSupportingMutationOperation,
  current: Task | TripInfoEntry | Expense | null,
) {
  if (operation.kind.endsWith('_create')) return Boolean(current);
  if (operation.kind.endsWith('_delete')) return current === null;
  if (!current) return false;
  if (operation.kind === 'task_update') return matchingFields(current, operation.input);
  if (operation.kind === 'trip_info_update') return matchingFields(current, operation.input);
  if (operation.kind === 'expense_update') {
    const expense = current as Expense;
    return Object.entries(operation.input).every(([key, value]) => {
      if (key === 'itineraryItemId') return expense.itineraryItem?.id === value;
      if (key === 'tripPlaceId') return expense.tripPlace?.id === value;
      return JSON.stringify(expense[key as keyof Expense]) === JSON.stringify(value);
    });
  }
  return false;
}

function supportingConflict(
  operation: OfflineSupportingMutationOperation,
  current: Task | TripInfoEntry | Expense | null,
) {
  if (operation.kind.endsWith('_create')) return false;
  if (!current) return !operation.kind.endsWith('_delete');
  if (operation.kind === 'task_update' || operation.kind === 'task_delete') {
    return current.updatedAt !== operation.baseTask.updatedAt;
  }
  if (operation.kind === 'trip_info_update' || operation.kind === 'trip_info_delete') {
    return current.updatedAt !== operation.baseEntry.updatedAt;
  }
  if (operation.kind === 'expense_update' || operation.kind === 'expense_delete') {
    return current.updatedAt !== operation.baseExpense.updatedAt;
  }
  return false;
}

async function replayItineraryMutation(
  mutation: OfflineMutation,
  operation: OfflineItineraryMutationOperation,
  accessToken: string,
  force: boolean,
) {
  const serverItinerary = await fetchServerItinerary(accessToken, mutation.tripId);
  if (operation.kind === 'itinerary_day_move') {
    const source = serverItinerary.days.find(
      (candidate) => candidate.id === operation.sourceItineraryDayId,
    );
    const target = serverItinerary.days.find(
      (candidate) => candidate.id === operation.input.targetItineraryDayId,
    );
    const sourceIds = source?.items.map(({ id }) => id) ?? [];
    const targetIds = target?.items.map(({ id }) => id) ?? [];
    const matches = (actual: string[], expected: string[]) =>
      actual.length === expected.length && actual.every((id, index) => id === expected[index]);
    const finalSourceIds =
      operation.input.strategy === 'swap' ? operation.input.expectedTargetItemIds : [];
    const finalTargetIds =
      operation.input.strategy === 'swap'
        ? operation.input.expectedSourceItemIds
        : [...operation.input.expectedTargetItemIds, ...operation.input.expectedSourceItemIds];
    if (
      source &&
      target &&
      matches(sourceIds, finalSourceIds) &&
      matches(targetIds, finalTargetIds)
    ) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    if (
      !source ||
      !target ||
      (!force &&
        (!matches(sourceIds, operation.input.expectedSourceItemIds) ||
          !matches(targetIds, operation.input.expectedTargetItemIds)))
    ) {
      await updateMutationState(
        mutation,
        'conflict',
        source && target ? 'itinerary_day_conflict' : 'day_missing',
      );
      return;
    }
    const replayOperation = force
      ? {
          ...operation,
          input: {
            ...operation.input,
            expectedSourceItemIds: sourceIds,
            expectedTargetItemIds: targetIds,
          },
        }
      : operation;
    const response = await apiRequest(accessToken, requestFor(replayOperation, mutation.tripId));
    if (response.ok) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    await updateMutationState(
      mutation,
      response.status === 409 ? 'conflict' : 'failed',
      body.code ?? `itinerary_request_failed_${response.status}`,
    );
    return;
  }
  if (operation.kind === 'itinerary_day_note') {
    const day = serverItinerary.days.find((candidate) => candidate.id === operation.itineraryDayId);
    if (day?.notes === operation.note) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    if (!force && (!day || day.notes !== operation.baseNote)) {
      await updateMutationState(
        mutation,
        'conflict',
        day ? 'itinerary_day_conflict' : 'day_missing',
      );
      return;
    }
    const response = await apiRequest(
      accessToken,
      requestFor(operation, mutation.tripId, undefined),
    );
    if (response.ok) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    await updateMutationState(
      mutation,
      response.status === 409 ? 'conflict' : 'failed',
      body.code ?? `itinerary_request_failed_${response.status}`,
    );
    return;
  }
  const itemId =
    operation.kind === 'itinerary_item_create' ? operation.clientItemId : operation.itemId;
  const current = findItem(serverItinerary, itemId);

  if (itineraryOperationAlreadyApplied(operation, current)) {
    await removeOfflineMutation(mutation.id);
    return;
  }
  if (!force && itineraryOperationConflicts(operation, current)) {
    await updateMutationState(
      mutation,
      'conflict',
      current ? 'itinerary_item_conflict' : 'itinerary_item_missing',
    );
    return;
  }

  const response = await apiRequest(
    accessToken,
    requestFor(operation, mutation.tripId, current?.updatedAt),
  );
  if (response.ok || (response.status === 404 && operation.kind === 'itinerary_item_delete')) {
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

async function replaySupportingMutation(
  mutation: OfflineMutation,
  accessToken: string,
  force: boolean,
) {
  const operation = mutation.operation as OfflineSupportingMutationOperation;
  const current = await supportingEntity(accessToken, mutation.tripId, operation);
  if (supportingAlreadyApplied(operation, current)) {
    await removeOfflineMutation(mutation.id);
    return;
  }
  if (!force && supportingConflict(operation, current)) {
    await updateMutationState(
      mutation,
      'conflict',
      current ? 'supporting_data_conflict' : 'supporting_data_missing',
    );
    return;
  }
  const response = await apiRequest(
    accessToken,
    requestFor(operation, mutation.tripId, current?.updatedAt),
  );
  if (response.ok || (response.status === 404 && operation.kind.endsWith('_delete'))) {
    await removeOfflineMutation(mutation.id);
    return;
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  await updateMutationState(
    mutation,
    response.status === 409 ? 'conflict' : 'failed',
    body.code ?? `supporting_request_failed_${response.status}`,
  );
}

/**
 * A 404 here means the trip is no longer reachable for the signed-in user, which
 * a retry can never fix. Returning null lets the caller offer a way out instead of
 * failing the same way forever.
 */
async function fetchServerMemories(accessToken: string, tripId: string) {
  const response = await apiRequest(accessToken, {
    method: 'GET',
    path: `/trips/${tripId}/memories`,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new OfflineSyncError(`memories_request_failed_${response.status}`);
  return response.json() as Promise<MemoriesResponse>;
}

async function failMemoryMutation(mutation: OfflineMutation, response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  await updateMutationState(mutation, 'failed', body.code ?? fallback);
}

/**
 * Metadata and photos replay as separate units against the same queue, so a
 * Memory that saved but still owes a photo keeps only that photo outstanding.
 * Both are keyed by identifiers chosen at capture time, which is what makes a
 * repeated attempt resolve to the record that already exists rather than a copy.
 */
async function replayMemoryMutation(
  mutation: OfflineMutation,
  operation: OfflineMemoryMutationOperation,
  accessToken: string,
) {
  if (operation.kind === 'memory_delete') {
    const response = await apiRequest(accessToken, requestFor(operation, mutation.tripId));
    if (response.ok || response.status === 404) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    await failMemoryMutation(mutation, response, `memory_request_failed_${response.status}`);
    return;
  }

  const server = await fetchServerMemories(accessToken, mutation.tripId);
  if (!server) {
    await updateMutationState(mutation, 'conflict', 'trip_missing');
    return;
  }
  const memory =
    server.memories.find((candidate) => candidate.id === operation.clientMemoryId) ?? null;

  if (operation.kind === 'memory_create') {
    if (memory) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    const response = await apiRequest(accessToken, requestFor(operation, mutation.tripId));
    if (response.ok) {
      await removeOfflineMutation(mutation.id);
      return;
    }
    await failMemoryMutation(mutation, response, `memory_request_failed_${response.status}`);
    return;
  }

  const media = await getOfflineMemoryMedia(
    mutation.userId,
    mutation.tripId,
    operation.clientPhotoId,
  );
  if (!memory || !media) {
    // The Memory or the photo itself was removed before this ran; nothing to upload.
    const stillQueued = (await listUserMutations(mutation.userId, mutation.tripId)).some(
      (candidate) =>
        candidate.operation.kind === 'memory_create' &&
        candidate.operation.clientMemoryId === operation.clientMemoryId,
    );
    if (memory || !stillQueued) {
      await removeOfflineMutation(mutation.id);
      await removeOfflineMemoryMedia(mutation.userId, mutation.tripId, operation.clientPhotoId);
    }
    return;
  }

  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new OfflineSyncError('supabase_not_configured');
  const uploaded = await uploadMemoryPhotoObject(
    supabase,
    operation.path,
    media.blob,
    operation.contentType,
  );
  if (!uploaded) {
    await updateMutationState(mutation, 'failed', 'memory_photo_upload_failed');
    return;
  }

  const response = await apiRequest(accessToken, requestFor(operation, mutation.tripId));
  if (response.ok) {
    await removeOfflineMutation(mutation.id);
    await removeOfflineMemoryMedia(mutation.userId, mutation.tripId, operation.clientPhotoId);
    return;
  }
  await failMemoryMutation(mutation, response, `memory_photo_request_failed_${response.status}`);
}

async function replayMutation(mutation: OfflineMutation, accessToken: string, force: boolean) {
  if (mutation.operation.kind.startsWith('itinerary_')) {
    return replayItineraryMutation(
      mutation,
      mutation.operation as OfflineItineraryMutationOperation,
      accessToken,
      force,
    );
  }
  if (mutation.operation.kind.startsWith('memory_')) {
    return replayMemoryMutation(
      mutation,
      mutation.operation as OfflineMemoryMutationOperation,
      accessToken,
    );
  }
  return replaySupportingMutation(mutation, accessToken, force);
}

async function refreshSnapshot(accessToken: string, userId: string, tripId: string) {
  const [server, tasksResponse, tripInfoResponse, expensesResponse] = await Promise.all([
    fetchServerItinerary(accessToken, tripId),
    apiRequest(accessToken, { method: 'GET', path: `/trips/${tripId}/tasks` }),
    apiRequest(accessToken, { method: 'GET', path: `/trips/${tripId}/info` }),
    apiRequest(accessToken, { method: 'GET', path: `/trips/${tripId}/expenses` }),
  ]);
  await saveItinerarySnapshot(userId, tripId, await mergeQueuedMutations(userId, tripId, server));
  if (tasksResponse.ok) {
    await saveSupportingSnapshot(
      userId,
      tripId,
      'tasks',
      (await tasksResponse.json()) as TasksResponse,
    );
  }
  if (tripInfoResponse.ok) {
    await saveSupportingSnapshot(
      userId,
      tripId,
      'tripInfo',
      (await tripInfoResponse.json()) as TripInfoResponse,
    );
  }
  if (expensesResponse.ok) {
    await saveSupportingSnapshot(
      userId,
      tripId,
      'expenses',
      (await expensesResponse.json()) as ExpensesResponse,
    );
  }

  // Memories are read on demand, so this refreshes what the device already holds
  // rather than pulling a trip's whole history and media down behind the scenes.
  const snapshot = await readTripSnapshot(userId, tripId);
  if (!snapshot?.memories) return;
  const memoriesResponse = await apiRequest(accessToken, {
    method: 'GET',
    path: `/trips/${tripId}/memories`,
  });
  if (!memoriesResponse.ok) return;
  await saveSupportingSnapshot(
    userId,
    tripId,
    'memories',
    await mergeQueuedMemories(
      userId,
      tripId,
      (await memoriesResponse.json()) as MemoriesResponse,
      snapshot,
    ),
  );
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
  if (touchedTrips.size && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OFFLINE_DATA_REFRESH_EVENT));
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
