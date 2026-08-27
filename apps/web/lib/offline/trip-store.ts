import type {
  Itinerary,
  ItineraryDayMoveInput,
  ItineraryDayRoutes,
  ItineraryItem,
  ItineraryItemInput,
  ItineraryScheduleInput,
  ItineraryTravelStatus,
} from '@/lib/itinerary/api';
import type { Expense, ExpenseInput, ExpensesResponse } from '@/lib/expenses/api';
import type { MemoriesResponse, Memory, MemoryInput } from '@/lib/memories/api';
import type { ReservationsResponse } from '@/lib/reservations/api';
import type { Task, TaskInput, TasksResponse } from '@/lib/tasks/api';
import type { TripInfoEntry, TripInfoInput, TripInfoResponse } from '@/lib/trip-info/api';
import type { Trip } from '@/lib/trips/api';
import { applyItineraryDayMove } from '@/lib/itinerary/day-move';
import { itemSortMinute, reslotItemByTime } from '@/lib/itinerary/item-order';
import { PRIVATE_MEDIA_CACHES } from '@/lib/media/storage-cache-key';

const DATABASE_NAME = 'trove-offline';
const DATABASE_VERSION = 4;
const SNAPSHOT_STORE = 'trip-snapshots';
const MUTATION_STORE = 'mutations';
const DOCUMENT_STORE = 'reservation-documents';
const MEMORY_MEDIA_STORE = 'memory-media';
const QUERY_CACHE_STORE = 'query-cache';
const LAST_OFFLINE_USER_KEY = 'trove.last-offline-user';
const OFFLINE_SNAPSHOT_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1_000;

export const OFFLINE_SYNC_EVENT = 'trove:offline-sync-change';
export const OFFLINE_CONNECTIVITY_EVENT = 'trove:offline-connectivity-change';
export const OFFLINE_DATA_REFRESH_EVENT = 'trove:offline-data-refresh';

let apiReachable = true;

export function isOfflineApiReachable() {
  return apiReachable;
}

export function setOfflineApiReachable(reachable: boolean) {
  if (apiReachable === reachable) return;
  apiReachable = reachable;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OFFLINE_CONNECTIVITY_EVENT));
  }
}

export function rememberOfflineUser(userId: string) {
  try {
    window.localStorage.setItem(LAST_OFFLINE_USER_KEY, userId);
  } catch {
    // IndexedDB remains scoped by the active session when local storage is unavailable.
  }
}

export function getRememberedOfflineUser() {
  try {
    return window.localStorage.getItem(LAST_OFFLINE_USER_KEY);
  } catch {
    return null;
  }
}

export type OfflineMutationState = 'conflict' | 'failed' | 'pending';

export type OfflineMutationOperation =
  | {
      input: ItineraryDayMoveInput;
      kind: 'itinerary_day_move';
      sourceItineraryDayId: string;
    }
  | {
      clientItemId: string;
      input: ItineraryItemInput & { itineraryDayId: string };
      kind: 'itinerary_item_create';
    }
  | {
      baseItem: ItineraryItem;
      itemId: string;
      kind: 'itinerary_item_delete';
    }
  | {
      baseItem: ItineraryItem;
      input: { itineraryDayId: string | null; position: number };
      itemId: string;
      kind: 'itinerary_item_organize';
    }
  | {
      baseItem: ItineraryItem;
      input: ItineraryItemInput;
      itemId: string;
      kind: 'itinerary_item_update';
    }
  | {
      baseItem: ItineraryItem;
      itemId: string;
      kind: 'itinerary_travel_status';
      travelStatus: ItineraryTravelStatus;
    }
  | {
      baseName: string | null;
      itineraryDayId: string;
      kind: 'itinerary_day_name';
      name: string | null;
    }
  | {
      baseNote: string | null;
      itineraryDayId: string;
      kind: 'itinerary_day_note';
      note: string | null;
    }
  | {
      clientTaskId: string;
      input: Required<Pick<TaskInput, 'context' | 'label'>> & TaskInput;
      kind: 'task_create';
    }
  | { baseTask: Task; input: TaskInput; kind: 'task_update'; taskId: string }
  | { baseTask: Task; kind: 'task_delete'; taskId: string }
  | {
      clientEntryId: string;
      input: Required<Pick<TripInfoInput, 'label' | 'value'>> & TripInfoInput;
      kind: 'trip_info_create';
    }
  | {
      baseEntry: TripInfoEntry;
      entryId: string;
      input: TripInfoInput;
      kind: 'trip_info_update';
    }
  | { baseEntry: TripInfoEntry; entryId: string; kind: 'trip_info_delete' }
  | { clientExpenseId: string; input: ExpenseInput; kind: 'expense_create' }
  | { baseExpense: Expense; expenseId: string; input: ExpenseInput; kind: 'expense_update' }
  | { baseExpense: Expense; expenseId: string; kind: 'expense_delete' }
  | { clientMemoryId: string; input: MemoryInput; kind: 'memory_create' }
  | {
      clientMemoryId: string;
      clientPhotoId: string;
      contentType: string;
      fileName: string;
      kind: 'memory_photo_create';
      path: string;
      sizeBytes: number;
    }
  | { kind: 'memory_delete'; memoryId: string };

export type OfflineSupportingSnapshotKey =
  'expenses' | 'memories' | 'reservations' | 'routes' | 'tasks' | 'tripInfo';

/**
 * A photo captured offline. The blob is held here rather than in the mutation so
 * the queue stays small and each photo can be retried or removed on its own. The
 * storage path is decided at capture time, which is what makes an interrupted
 * upload safe to repeat.
 */
export type OfflineMemoryMedia = {
  blob: Blob;
  clientMemoryId: string;
  clientPhotoId: string;
  createdAt: string;
  key: string;
  sizeBytes: number;
  tripId: string;
  userId: string;
};

export type OfflineReservationDocument = {
  attachmentId: string;
  blob: Blob | null;
  contentType: string;
  fileName: string;
  key: string;
  reservationId: string;
  savedAt: string | null;
  selectedAt: string;
  sizeBytes: number;
  sourceUrl: string | null;
  tripId: string;
  userId: string;
};

export type OfflineItineraryMutationOperation = Extract<
  OfflineMutationOperation,
  { kind: `itinerary_${string}` }
>;

export type OfflineMemoryMutationOperation = Extract<
  OfflineMutationOperation,
  { kind: `memory_${string}` }
>;

export type OfflineSupportingMutationOperation = Exclude<
  OfflineMutationOperation,
  OfflineItineraryMutationOperation | OfflineMemoryMutationOperation
>;

export type OfflineMutation = {
  attempts: number;
  createdAt: string;
  errorCode: string | null;
  id: string;
  operation: OfflineMutationOperation;
  state: OfflineMutationState;
  tripId: string;
  updatedAt: string;
  userId: string;
};

/**
 * A day's travel legs together with the day ordering they were computed for.
 *
 * The legs are only meaningful for that exact ordering: they are a chain from
 * one stop to the next, so replaying them against a reordered day would name
 * origins that no longer precede their destination. Keeping the revision with
 * the payload is what lets a reader tell the difference.
 */
export type OfflineCachedDayRoutes = {
  data: ItineraryDayRoutes;
  revision: string;
};

export type OfflineTripSnapshot = {
  expenses: ExpensesResponse | null;
  itinerary: Itinerary | null;
  key: string;
  memories: MemoriesResponse | null;
  lastPreparationAttemptAt: string | null;
  preparationError: string | null;
  preparedAt: string | null;
  reservations: ReservationsResponse | null;
  routes: Record<string, OfflineCachedDayRoutes>;
  savedAt: string;
  tasks: TasksResponse | null;
  trip: Trip | null;
  tripInfo: TripInfoResponse | null;
  tripId: string;
  userId: string;
};

export type OfflineReadinessState = 'error' | 'not_ready' | 'partial' | 'ready' | 'stale';

export type OfflineReadinessCategory = {
  key: 'documents' | 'expenses' | 'itinerary' | 'places' | 'reservations' | 'supporting' | 'trip';
  state: 'error' | 'not_ready' | 'ready';
};

export type OfflineTripReadiness = {
  categories: OfflineReadinessCategory[];
  lastPreparedAt: string | null;
  state: OfflineReadinessState;
};

export type TripSyncSummary = {
  conflict: number;
  failed: number;
  pending: number;
};

function snapshotKey(userId: string, tripId: string) {
  return `${userId}:${tripId}`;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('offline_storage_unavailable'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      'upgradeneeded',
      () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
          store.createIndex('by-user', 'userId');
        }
        if (!database.objectStoreNames.contains(MUTATION_STORE)) {
          const store = database.createObjectStore(MUTATION_STORE, { keyPath: 'id' });
          store.createIndex('by-user', 'userId');
          store.createIndex('by-user-trip', ['userId', 'tripId']);
        }
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
          const store = database.createObjectStore(DOCUMENT_STORE, { keyPath: 'key' });
          store.createIndex('by-user', 'userId');
          store.createIndex('by-user-trip', ['userId', 'tripId']);
        }
        if (!database.objectStoreNames.contains(MEMORY_MEDIA_STORE)) {
          const store = database.createObjectStore(MEMORY_MEDIA_STORE, { keyPath: 'key' });
          store.createIndex('by-user', 'userId');
          store.createIndex('by-user-trip', ['userId', 'tripId']);
        }
        // The read cache lives here rather than in a database of its own so it
        // shares one version ladder and one wipe path with everything else that
        // is private to a signed-in traveller.
        if (!database.objectStoreNames.contains(QUERY_CACHE_STORE)) {
          database.createObjectStore(QUERY_CACHE_STORE, { keyPath: 'key' });
        }
      },
      { once: true },
    );
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => {
        databasePromise = null;
        reject(request.error);
      },
      { once: true },
    );
  });

  return databasePromise;
}

function announceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}

export async function readTripSnapshot(userId: string, tripId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readonly');
  return requestResult<OfflineTripSnapshot | undefined>(
    transaction.objectStore(SNAPSHOT_STORE).get(snapshotKey(userId, tripId)),
  );
}

async function writeSnapshot(snapshot: OfflineTripSnapshot) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
  await transactionDone(transaction);
  announceChange();
}

async function updateSnapshot(
  userId: string,
  tripId: string,
  update: (current: OfflineTripSnapshot | undefined) => OfflineTripSnapshot,
) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite');
  const store = transaction.objectStore(SNAPSHOT_STORE);
  const current = await requestResult<OfflineTripSnapshot | undefined>(
    store.get(snapshotKey(userId, tripId)),
  );
  store.put(update(current));
  await transactionDone(transaction);
  announceChange();
}

export async function saveItinerarySnapshot(userId: string, tripId: string, itinerary: Itinerary) {
  await updateSnapshot(userId, tripId, (current) => ({
    expenses: current?.expenses ?? null,
    itinerary,
    key: snapshotKey(userId, tripId),
    lastPreparationAttemptAt: current?.lastPreparationAttemptAt ?? null,
    memories: current?.memories ?? null,
    preparationError: current?.preparationError ?? null,
    preparedAt: current?.preparedAt ?? null,
    reservations: current?.reservations ?? null,
    routes: current?.routes ?? {},
    savedAt: new Date().toISOString(),
    tasks: current?.tasks ?? null,
    trip: current?.trip ?? null,
    tripId,
    tripInfo: current?.tripInfo ?? null,
    userId,
  }));
}

export async function mergeQueuedMutations(userId: string, tripId: string, itinerary: Itinerary) {
  const mutations = await listUserMutations(userId, tripId);
  return mutations.reduce(
    (current, mutation) =>
      isItineraryOperation(mutation.operation)
        ? applyOfflineMutation(current, mutation.operation)
        : current,
    itinerary,
  );
}

export async function saveTripSnapshot(userId: string, trip: Trip) {
  await updateSnapshot(userId, trip.id, (current) => ({
    expenses: current?.expenses ?? null,
    itinerary: current?.itinerary ?? null,
    key: snapshotKey(userId, trip.id),
    lastPreparationAttemptAt: current?.lastPreparationAttemptAt ?? null,
    memories: current?.memories ?? null,
    preparationError: current?.preparationError ?? null,
    preparedAt: current?.preparedAt ?? null,
    reservations: current?.reservations ?? null,
    routes: current?.routes ?? {},
    savedAt: new Date().toISOString(),
    tasks: current?.tasks ?? null,
    trip: { ...trip, coverPhotoUrl: null },
    tripId: trip.id,
    tripInfo: current?.tripInfo ?? null,
    userId,
  }));
}

export async function saveSupportingSnapshot<Key extends OfflineSupportingSnapshotKey>(
  userId: string,
  tripId: string,
  key: Key,
  value: NonNullable<OfflineTripSnapshot[Key]>,
) {
  await updateSnapshot(userId, tripId, (current) => ({
    expenses: current?.expenses ?? null,
    itinerary: current?.itinerary ?? null,
    key: snapshotKey(userId, tripId),
    lastPreparationAttemptAt: current?.lastPreparationAttemptAt ?? null,
    memories: current?.memories ?? null,
    preparationError: current?.preparationError ?? null,
    preparedAt: current?.preparedAt ?? null,
    reservations: current?.reservations ?? null,
    routes: current?.routes ?? {},
    savedAt: new Date().toISOString(),
    tasks: current?.tasks ?? null,
    trip: current?.trip ?? null,
    tripId,
    tripInfo: current?.tripInfo ?? null,
    userId,
    [key]: value,
  }));
}

function isCompleteTripRange(itinerary: Itinerary) {
  const start = new Date(`${itinerary.trip.startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${itinerary.trip.endDate}T00:00:00.000Z`).getTime();
  const expectedDays = Math.round((end - start) / (24 * 60 * 60 * 1_000)) + 1;
  if (expectedDays < 1 || itinerary.days.length !== expectedDays) return false;

  return itinerary.days.every((day, index) => {
    const expected = new Date(start + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    return day.date === expected;
  });
}

function hasPlaceContext(itinerary: Itinerary) {
  const tripPlaceIds = new Set(itinerary.tripPlaces.map((tripPlace) => tripPlace.id));
  const references = [
    ...itinerary.days.flatMap((day) => [
      ...(day.dailyBaseTripPlaceId ? [day.dailyBaseTripPlaceId] : []),
      ...(day.dailyBaseDepartureTripPlaceId ? [day.dailyBaseDepartureTripPlaceId] : []),
      ...day.items.flatMap((item) => (item.tripPlace ? [item.tripPlace.id] : [])),
    ]),
    ...itinerary.unscheduledItems.flatMap((item) => (item.tripPlace ? [item.tripPlace.id] : [])),
  ];
  return references.every((tripPlaceId) => tripPlaceIds.has(tripPlaceId));
}

export function getOfflineTripReadiness(
  snapshot: OfflineTripSnapshot | undefined,
  documents: OfflineReservationDocument[] = [],
): OfflineTripReadiness {
  const tripReady = Boolean(snapshot?.trip && snapshot.itinerary?.trip.id === snapshot.trip.id);
  const itineraryReady = Boolean(snapshot?.itinerary && isCompleteTripRange(snapshot.itinerary));
  const placesReady = Boolean(snapshot?.itinerary && hasPlaceContext(snapshot.itinerary));
  const reservationsReady = Boolean(snapshot?.reservations);
  const supportingReady = Boolean(snapshot?.tasks && snapshot.tripInfo);
  const expensesReady = Boolean(snapshot?.expenses);
  const categories: OfflineReadinessCategory[] = [
    { key: 'trip', state: tripReady ? 'ready' : 'not_ready' },
    { key: 'itinerary', state: itineraryReady ? 'ready' : 'not_ready' },
    { key: 'places', state: placesReady ? 'ready' : 'not_ready' },
    { key: 'reservations', state: reservationsReady ? 'ready' : 'not_ready' },
    { key: 'supporting', state: supportingReady ? 'ready' : 'not_ready' },
    { key: 'expenses', state: expensesReady ? 'ready' : 'not_ready' },
    ...(documents.length
      ? [
          {
            key: 'documents' as const,
            state: documents.every((document) => document.blob)
              ? ('ready' as const)
              : ('not_ready' as const),
          },
        ]
      : []),
  ];
  const coreReady = categories.every((category) => category.state === 'ready');

  if (snapshot?.preparationError) {
    return {
      categories: categories.map((category) =>
        category.state === 'not_ready' ? { ...category, state: 'error' } : category,
      ),
      lastPreparedAt: snapshot.preparedAt,
      state: 'error',
    };
  }
  if (!coreReady) {
    return {
      categories,
      lastPreparedAt: snapshot?.preparedAt ?? null,
      state: categories.some((category) => category.state === 'ready') ? 'partial' : 'not_ready',
    };
  }
  if (!snapshot?.preparedAt) return { categories, lastPreparedAt: null, state: 'partial' };
  const preparedAt = new Date(snapshot.preparedAt).getTime();
  if (!Number.isFinite(preparedAt) || Date.now() - preparedAt > OFFLINE_SNAPSHOT_STALE_AFTER_MS) {
    return { categories, lastPreparedAt: snapshot.preparedAt, state: 'stale' };
  }
  return { categories, lastPreparedAt: snapshot.preparedAt, state: 'ready' };
}

export async function markTripPrepared(userId: string, tripId: string) {
  await updateSnapshot(userId, tripId, (current) => {
    if (!current) throw new Error('offline_trip_not_prepared');
    const now = new Date().toISOString();
    return {
      ...current,
      lastPreparationAttemptAt: now,
      preparationError: null,
      preparedAt: now,
    };
  });
}

export async function recordTripPreparationError(
  userId: string,
  tripId: string,
  errorCode: string,
) {
  await updateSnapshot(userId, tripId, (current) => ({
    expenses: current?.expenses ?? null,
    itinerary: current?.itinerary ?? null,
    key: snapshotKey(userId, tripId),
    lastPreparationAttemptAt: new Date().toISOString(),
    memories: current?.memories ?? null,
    preparationError: errorCode,
    preparedAt: current?.preparedAt ?? null,
    reservations: current?.reservations ?? null,
    routes: current?.routes ?? {},
    savedAt: current?.savedAt ?? new Date().toISOString(),
    tasks: current?.tasks ?? null,
    trip: current?.trip ?? null,
    tripId,
    tripInfo: current?.tripInfo ?? null,
    userId,
  }));
}

export async function listTripSnapshots(userId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOT_STORE, 'readonly');
  const snapshots = await requestResult<OfflineTripSnapshot[]>(
    transaction.objectStore(SNAPSHOT_STORE).index('by-user').getAll(IDBKeyRange.only(userId)),
  );
  return snapshots.toSorted((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function listUserMutations(userId: string, tripId?: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readonly');
  const store = transaction.objectStore(MUTATION_STORE);
  const request = tripId
    ? store.index('by-user-trip').getAll(IDBKeyRange.only([userId, tripId]))
    : store.index('by-user').getAll(IDBKeyRange.only(userId));
  const mutations = await requestResult<OfflineMutation[]>(request);
  return mutations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putOfflineMutation(mutation: OfflineMutation) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readwrite');
  transaction.objectStore(MUTATION_STORE).put(mutation);
  await transactionDone(transaction);
  announceChange();
}

export async function queueOfflineMutation(mutation: OfflineMutation) {
  const database = await openDatabase();
  const transaction = database.transaction([SNAPSHOT_STORE, MUTATION_STORE], 'readwrite');
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const snapshot = await requestResult<OfflineTripSnapshot | undefined>(
    snapshotStore.get(snapshotKey(mutation.userId, mutation.tripId)),
  );
  if (!snapshot?.itinerary) {
    transaction.abort();
    throw new Error('offline_trip_not_prepared');
  }
  snapshotStore.put({
    ...snapshot,
    ...applyOperationToSnapshot(snapshot, mutation.operation),
    savedAt: new Date().toISOString(),
  });
  mutationStore.put(mutation);
  await transactionDone(transaction);
  announceChange();
}

export async function removeOfflineMutation(id: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readwrite');
  transaction.objectStore(MUTATION_STORE).delete(id);
  await transactionDone(transaction);
  announceChange();
}

export async function getTripSyncSummary(userId: string, tripId: string) {
  const mutations = await listUserMutations(userId, tripId);
  return mutations.reduce<TripSyncSummary>(
    (summary, mutation) => ({ ...summary, [mutation.state]: summary[mutation.state] + 1 }),
    { conflict: 0, failed: 0, pending: 0 },
  );
}

export async function hasUnsyncedOfflineChanges(userId?: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MUTATION_STORE, 'readonly');
  const store = transaction.objectStore(MUTATION_STORE);
  const request = userId ? store.index('by-user').count(IDBKeyRange.only(userId)) : store.count();
  return (await requestResult(request)) > 0;
}

export async function clearAllOfflineTripData() {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(
      [SNAPSHOT_STORE, MUTATION_STORE, DOCUMENT_STORE, MEMORY_MEDIA_STORE, QUERY_CACHE_STORE],
      'readwrite',
    );
    transaction.objectStore(SNAPSHOT_STORE).clear();
    transaction.objectStore(MUTATION_STORE).clear();
    transaction.objectStore(DOCUMENT_STORE).clear();
    transaction.objectStore(MEMORY_MEDIA_STORE).clear();
    transaction.objectStore(QUERY_CACHE_STORE).clear();
    await transactionDone(transaction);
  } catch {
    // Continue clearing the user marker and private route caches.
  }
  try {
    window.localStorage.removeItem(LAST_OFFLINE_USER_KEY);
  } catch {
    // The IndexedDB copy has still been removed.
  }
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(
          (cacheName) =>
            cacheName.includes('trove-pwa-trip-mode') || PRIVATE_MEDIA_CACHES.includes(cacheName),
        )
        .map((cacheName) => caches.delete(cacheName)),
    );
  }
  announceChange();
}

export async function removeTripOfflineData(userId: string, tripId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOT_STORE, MUTATION_STORE, DOCUMENT_STORE, MEMORY_MEDIA_STORE],
    'readwrite',
  );
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const documentStore = transaction.objectStore(DOCUMENT_STORE);
  const mediaStore = transaction.objectStore(MEMORY_MEDIA_STORE);
  const pendingCount = await requestResult(
    mutationStore.index('by-user-trip').count(IDBKeyRange.only([userId, tripId])),
  );
  if (pendingCount > 0) {
    throw new Error('offline_changes_pending');
  }
  snapshotStore.delete(snapshotKey(userId, tripId));
  const documentKeys = await requestResult<IDBValidKey[]>(
    documentStore.index('by-user-trip').getAllKeys(IDBKeyRange.only([userId, tripId])),
  );
  for (const key of documentKeys) documentStore.delete(key);
  const mediaKeys = await requestResult<IDBValidKey[]>(
    mediaStore.index('by-user-trip').getAllKeys(IDBKeyRange.only([userId, tripId])),
  );
  for (const key of mediaKeys) mediaStore.delete(key);
  await transactionDone(transaction);

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.includes('trove-pwa-trip-mode'))
        .map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          await Promise.all(
            requests
              .filter((request) => new URL(request.url).pathname.startsWith(`/trips/${tripId}/`))
              .map((request) => cache.delete(request)),
          );
        }),
    );
  }
  announceChange();
}

function documentKey(userId: string, tripId: string, attachmentId: string) {
  return `${userId}:${tripId}:${attachmentId}`;
}

export async function listOfflineReservationDocuments(userId: string, tripId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENT_STORE, 'readonly');
  return requestResult<OfflineReservationDocument[]>(
    transaction
      .objectStore(DOCUMENT_STORE)
      .index('by-user-trip')
      .getAll(IDBKeyRange.only([userId, tripId])),
  );
}

export async function selectOfflineReservationDocument(
  document: Omit<OfflineReservationDocument, 'key'>,
) {
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
  transaction.objectStore(DOCUMENT_STORE).put({
    ...document,
    key: documentKey(document.userId, document.tripId, document.attachmentId),
  });
  await transactionDone(transaction);
  announceChange();
}

export async function removeOfflineReservationDocument(
  userId: string,
  tripId: string,
  attachmentId: string,
) {
  const database = await openDatabase();
  const transaction = database.transaction(DOCUMENT_STORE, 'readwrite');
  transaction.objectStore(DOCUMENT_STORE).delete(documentKey(userId, tripId, attachmentId));
  await transactionDone(transaction);
  announceChange();
}

function memoryMediaKey(userId: string, tripId: string, clientPhotoId: string) {
  return `${userId}:${tripId}:${clientPhotoId}`;
}

export async function listOfflineMemoryMedia(userId: string, tripId?: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MEMORY_MEDIA_STORE, 'readonly');
  const store = transaction.objectStore(MEMORY_MEDIA_STORE);
  const request = tripId
    ? store.index('by-user-trip').getAll(IDBKeyRange.only([userId, tripId]))
    : store.index('by-user').getAll(IDBKeyRange.only(userId));
  return requestResult<OfflineMemoryMedia[]>(request);
}

export async function getOfflineMemoryMedia(userId: string, tripId: string, clientPhotoId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MEMORY_MEDIA_STORE, 'readonly');
  return requestResult<OfflineMemoryMedia | undefined>(
    transaction.objectStore(MEMORY_MEDIA_STORE).get(memoryMediaKey(userId, tripId, clientPhotoId)),
  );
}

export async function removeOfflineMemoryMedia(
  userId: string,
  tripId: string,
  clientPhotoId: string,
) {
  const database = await openDatabase();
  const transaction = database.transaction(MEMORY_MEDIA_STORE, 'readwrite');
  transaction.objectStore(MEMORY_MEDIA_STORE).delete(memoryMediaKey(userId, tripId, clientPhotoId));
  await transactionDone(transaction);
  announceChange();
}

/**
 * Writes a capture, its photo blobs, and the local preview in one transaction so
 * a reload can never find a queued Memory whose photos were lost, or the reverse.
 */
export async function queueOfflineMemoryCapture(
  mutations: OfflineMutation[],
  media: Array<Omit<OfflineMemoryMedia, 'key'>>,
) {
  const [first] = mutations;
  if (!first) return;

  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOT_STORE, MUTATION_STORE, MEMORY_MEDIA_STORE],
    'readwrite',
  );
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const mediaStore = transaction.objectStore(MEMORY_MEDIA_STORE);
  const snapshot = await requestResult<OfflineTripSnapshot | undefined>(
    snapshotStore.get(snapshotKey(first.userId, first.tripId)),
  );
  if (!snapshot) {
    transaction.abort();
    throw new Error('offline_trip_not_prepared');
  }

  const memories = mutations.reduce(
    (current, mutation) => applyMemoryOperation(snapshot, current, mutation.operation),
    snapshot.memories ?? { memories: [], storyCover: null },
  );
  snapshotStore.put({ ...snapshot, memories, savedAt: new Date().toISOString() });
  for (const mutation of mutations) mutationStore.put(mutation);
  for (const entry of media) {
    mediaStore.put({
      ...entry,
      key: memoryMediaKey(entry.userId, entry.tripId, entry.clientPhotoId),
    });
  }
  await transactionDone(transaction);
  announceChange();
}

/**
 * Removes a Memory that has not finished syncing. Queued work and its blobs go
 * first so nothing can still be uploaded; when the metadata already reached the
 * server the removal continues as an ordinary queued delete.
 */
export async function removePendingMemoryCapture(
  userId: string,
  tripId: string,
  clientMemoryId: string,
) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOT_STORE, MUTATION_STORE, MEMORY_MEDIA_STORE],
    'readwrite',
  );
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const mediaStore = transaction.objectStore(MEMORY_MEDIA_STORE);
  const mutations = await requestResult<OfflineMutation[]>(
    mutationStore.index('by-user-trip').getAll(IDBKeyRange.only([userId, tripId])),
  );

  let createQueued = false;
  for (const mutation of mutations) {
    const operation = mutation.operation;
    if (operation.kind === 'memory_create' && operation.clientMemoryId === clientMemoryId) {
      createQueued = true;
      mutationStore.delete(mutation.id);
    }
    if (operation.kind === 'memory_photo_create' && operation.clientMemoryId === clientMemoryId) {
      mutationStore.delete(mutation.id);
      mediaStore.delete(memoryMediaKey(userId, tripId, operation.clientPhotoId));
    }
  }

  if (!createQueued) {
    const now = new Date().toISOString();
    mutationStore.put({
      attempts: 0,
      createdAt: now,
      errorCode: null,
      id: crypto.randomUUID(),
      operation: { kind: 'memory_delete', memoryId: clientMemoryId },
      state: 'pending',
      tripId,
      updatedAt: now,
      userId,
    } satisfies OfflineMutation);
  }

  const snapshot = await requestResult<OfflineTripSnapshot | undefined>(
    snapshotStore.get(snapshotKey(userId, tripId)),
  );
  if (snapshot?.memories) {
    snapshotStore.put({
      ...snapshot,
      memories: {
        ...snapshot.memories,
        memories: snapshot.memories.memories.filter((memory) => memory.id !== clientMemoryId),
      },
      savedAt: new Date().toISOString(),
    });
  }
  await transactionDone(transaction);
  announceChange();
}

/** Drops one queued photo; the Memory and every other photo stay as they are. */
export async function removePendingMemoryPhoto(
  userId: string,
  tripId: string,
  clientPhotoId: string,
) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOT_STORE, MUTATION_STORE, MEMORY_MEDIA_STORE],
    'readwrite',
  );
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const mutations = await requestResult<OfflineMutation[]>(
    mutationStore.index('by-user-trip').getAll(IDBKeyRange.only([userId, tripId])),
  );
  const queued = mutations.find(
    (mutation) =>
      mutation.operation.kind === 'memory_photo_create' &&
      mutation.operation.clientPhotoId === clientPhotoId,
  );
  if (!queued) {
    transaction.abort();
    throw new Error('offline_memory_photo_already_uploaded');
  }

  mutationStore.delete(queued.id);
  transaction.objectStore(MEMORY_MEDIA_STORE).delete(memoryMediaKey(userId, tripId, clientPhotoId));

  const snapshot = await requestResult<OfflineTripSnapshot | undefined>(
    snapshotStore.get(snapshotKey(userId, tripId)),
  );
  if (snapshot?.memories) {
    snapshotStore.put({
      ...snapshot,
      memories: {
        ...snapshot.memories,
        memories: snapshot.memories.memories.map((memory) => ({
          ...memory,
          photos: memory.photos.filter((photo) => photo.id !== clientPhotoId),
        })),
      },
      savedAt: new Date().toISOString(),
    });
  }
  await transactionDone(transaction);
  announceChange();
}

function findItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    const item = day.items.find((candidate) => candidate.id === itemId);
    if (item) return item;
  }
  return itinerary.unscheduledItems.find((candidate) => candidate.id === itemId) ?? null;
}

function removeItem(itinerary: Itinerary, itemId: string) {
  for (const day of itinerary.days) {
    day.items = day.items.filter((item) => item.id !== itemId);
  }
  itinerary.unscheduledItems = itinerary.unscheduledItems.filter((item) => item.id !== itemId);
}

function normalizePositions(items: ItineraryItem[]) {
  items.forEach((item, position) => {
    item.position = position;
  });
}

function applySchedule(item: ItineraryItem, schedule: ItineraryScheduleInput) {
  if (schedule.kind === 'exact') {
    item.dayPart = null;
    item.localStartTime = schedule.localTime;
    item.startInstant = null;
    item.timeSemantics = 'floating_local';
    return;
  }
  item.dayPart = schedule.kind === 'day_part' ? schedule.dayPart : null;
  item.localStartTime = null;
  item.startInstant = null;
  item.timeSemantics = null;
}

function applyInput(item: ItineraryItem, input: ItineraryItemInput, itinerary?: Itinerary) {
  if (input.customLabel !== undefined) item.customLabel = input.customLabel?.trim() || null;
  if (input.customLocation !== undefined) {
    item.customLocation = input.customLocation
      ? { label: input.customLocation.label, timeZone: input.customLocation.timeZone ?? null }
      : null;
  }
  if (input.durationMinutes !== undefined) item.durationMinutes = input.durationMinutes;
  if (input.localEndTime !== undefined) item.localEndTime = input.localEndTime;
  else if (input.durationMinutes !== undefined) item.localEndTime = null;
  if (input.notes !== undefined) item.notes = input.notes?.trim() || null;
  if (input.plannedCost !== undefined) item.plannedCost = input.plannedCost;
  if (input.priority !== undefined) item.priority = input.priority;
  if (input.tripPlaceId !== undefined) {
    item.tripPlace = input.tripPlaceId
      ? (itinerary?.tripPlaces.find((candidate) => candidate.id === input.tripPlaceId) ?? null)
      : null;
  }
  if (input.schedule) applySchedule(item, input.schedule);
  if (item.localEndTime && item.localStartTime) {
    const [startHour = 0, startMinute = 0] = item.localStartTime.split(':').map(Number);
    const [endHour = 0, endMinute = 0] = item.localEndTime.split(':').map(Number);
    item.durationMinutes = (endHour - startHour) * 60 + endMinute - startMinute;
  } else if (input.localEndTime === null && input.durationMinutes === undefined) {
    item.durationMinutes = null;
  }
  item.updatedAt = new Date().toISOString();
}

export function isItineraryOperation(
  operation: OfflineMutationOperation,
): operation is OfflineItineraryMutationOperation {
  return operation.kind.startsWith('itinerary_');
}

export function applyOfflineMutation(
  itinerary: Itinerary,
  mutation: OfflineItineraryMutationOperation,
) {
  const next = structuredClone(itinerary);

  if (mutation.kind === 'itinerary_day_note') {
    const day = next.days.find((candidate) => candidate.id === mutation.itineraryDayId);
    if (day) day.notes = mutation.note?.trim() || null;
    return next;
  }

  if (mutation.kind === 'itinerary_day_name') {
    const day = next.days.find((candidate) => candidate.id === mutation.itineraryDayId);
    if (day) day.name = mutation.name?.trim() || null;
    return next;
  }

  if (mutation.kind === 'itinerary_day_move') {
    return applyItineraryDayMove(next, mutation.sourceItineraryDayId, mutation.input);
  }

  if (mutation.kind === 'itinerary_item_create') {
    if (findItem(next, mutation.clientItemId)) return next;
    const day = next.days.find((candidate) => candidate.id === mutation.input.itineraryDayId);
    if (!day) return next;
    const now = new Date().toISOString();
    const tripPlace = mutation.input.tripPlaceId
      ? (next.tripPlaces.find((candidate) => candidate.id === mutation.input.tripPlaceId) ?? null)
      : null;
    const item: ItineraryItem = {
      createdAt: now,
      customLabel: mutation.input.customLabel?.trim() || null,
      customLocation: mutation.input.customLocation
        ? {
            label: mutation.input.customLocation.label,
            timeZone: mutation.input.customLocation.timeZone ?? null,
          }
        : null,
      dayPart: null,
      durationMinutes: mutation.input.durationMinutes ?? null,
      id: mutation.clientItemId,
      itineraryDayId: day.id,
      localEndTime: mutation.input.localEndTime ?? null,
      localStartTime: null,
      notes: mutation.input.notes?.trim() || null,
      plannedCost: mutation.input.plannedCost ?? null,
      position: day.items.length,
      priority: mutation.input.priority ?? null,
      startInstant: null,
      timeSemantics: null,
      timeZone: tripPlace?.place.timeZone ?? day.defaultTimeZone,
      timeZoneSource: tripPlace ? 'place' : 'day_default',
      travelModeToNext: 'drive',
      travelStatus: 'upcoming',
      tripPlace,
      updatedAt: now,
    };
    applyInput(item, mutation.input, next);
    day.items.push(item);
    reslotItemByTime(day.items, item.id);
    normalizePositions(day.items);
    return next;
  }

  const item = findItem(next, mutation.itemId);
  if (!item) return next;

  if (mutation.kind === 'itinerary_item_delete') {
    removeItem(next, mutation.itemId);
    return next;
  }

  if (mutation.kind === 'itinerary_travel_status') {
    item.travelStatus = mutation.travelStatus;
    item.updatedAt = new Date().toISOString();
    return next;
  }

  if (mutation.kind === 'itinerary_item_update') {
    const before = itemSortMinute(item);
    applyInput(item, mutation.input, next);
    if (itemSortMinute(item) !== before) {
      const day = next.days.find((candidate) =>
        candidate.items.some((candidateItem) => candidateItem.id === item.id),
      );
      if (day) {
        reslotItemByTime(day.items, item.id);
        normalizePositions(day.items);
      }
    }
    return next;
  }

  removeItem(next, mutation.itemId);
  item.itineraryDayId = mutation.input.itineraryDayId;
  const targetItems = mutation.input.itineraryDayId
    ? next.days.find((day) => day.id === mutation.input.itineraryDayId)?.items
    : next.unscheduledItems;
  if (!targetItems) return next;
  targetItems.splice(Math.min(Math.max(mutation.input.position, 0), targetItems.length), 0, item);
  for (const day of next.days) normalizePositions(day.items);
  normalizePositions(next.unscheduledItems);
  item.updatedAt = new Date().toISOString();
  return next;
}

function taskFromOperation(
  operation: Extract<OfflineMutationOperation, { kind: 'task_create' }>,
): Task {
  const now = new Date().toISOString();
  return {
    completed: operation.input.completed ?? false,
    completedAt: operation.input.completed ? now : null,
    context: operation.input.context,
    createdAt: now,
    dueDate: operation.input.dueDate ?? null,
    dueLocalTime: operation.input.dueLocalTime ?? null,
    dueTimeZone: null,
    id: operation.clientTaskId,
    label: operation.input.label.trim(),
    note: operation.input.note?.trim() || null,
    updatedAt: now,
  };
}

function applyTaskInput(task: Task, input: TaskInput) {
  if (input.completed !== undefined) {
    task.completed = input.completed;
    task.completedAt = input.completed ? new Date().toISOString() : null;
  }
  if (input.context !== undefined) task.context = input.context;
  if (input.dueDate !== undefined) task.dueDate = input.dueDate;
  if (input.dueLocalTime !== undefined) task.dueLocalTime = input.dueLocalTime;
  if (input.label !== undefined) task.label = input.label.trim();
  if (input.note !== undefined) task.note = input.note?.trim() || null;
  task.updatedAt = new Date().toISOString();
}

function applyTaskOperation(data: TasksResponse, operation: OfflineMutationOperation) {
  const next = structuredClone(data);
  if (operation.kind === 'task_create') {
    const task = next.tasks.find((candidate) => candidate.id === operation.clientTaskId);
    if (task) {
      applyTaskInput(task, operation.input);
    } else {
      next.tasks.unshift(taskFromOperation(operation));
    }
  } else if (operation.kind === 'task_update') {
    const task = next.tasks.find((candidate) => candidate.id === operation.taskId);
    if (task) applyTaskInput(task, operation.input);
  } else if (operation.kind === 'task_delete') {
    next.tasks = next.tasks.filter((task) => task.id !== operation.taskId);
  }
  return next;
}

export function applyOfflineTaskMutation(
  data: TasksResponse,
  operation:
    | Extract<OfflineMutationOperation, { kind: 'task_create' }>
    | Extract<OfflineMutationOperation, { kind: 'task_delete' }>
    | Extract<OfflineMutationOperation, { kind: 'task_update' }>,
) {
  return applyTaskOperation(data, operation);
}

function applyTripInfoOperation(data: TripInfoResponse, operation: OfflineMutationOperation) {
  const next = structuredClone(data);
  if (operation.kind === 'trip_info_create') {
    const entry = next.entries.find((candidate) => candidate.id === operation.clientEntryId);
    if (entry) {
      const input = operation.input;
      entry.category = input.category?.trim() || null;
      entry.isPinned = input.isPinned ?? false;
      entry.label = input.label.trim();
      entry.link = input.link?.trim() || null;
      entry.note = input.note?.trim() || null;
      entry.updatedAt = new Date().toISOString();
      entry.value = input.value.trim();
    } else {
      const now = new Date().toISOString();
      next.entries.unshift({
        category: operation.input.category?.trim() || null,
        createdAt: now,
        id: operation.clientEntryId,
        isPinned: operation.input.isPinned ?? false,
        label: operation.input.label.trim(),
        link: operation.input.link?.trim() || null,
        note: operation.input.note?.trim() || null,
        updatedAt: now,
        value: operation.input.value.trim(),
      });
    }
  } else if (operation.kind === 'trip_info_update') {
    const entry = next.entries.find((candidate) => candidate.id === operation.entryId);
    if (entry) {
      const input = operation.input;
      if (input.category !== undefined) entry.category = input.category?.trim() || null;
      if (input.isPinned !== undefined) entry.isPinned = input.isPinned;
      if (input.label !== undefined) entry.label = input.label.trim();
      if (input.link !== undefined) entry.link = input.link?.trim() || null;
      if (input.note !== undefined) entry.note = input.note?.trim() || null;
      if (input.value !== undefined) entry.value = input.value.trim();
      entry.updatedAt = new Date().toISOString();
    }
  } else if (operation.kind === 'trip_info_delete') {
    next.entries = next.entries.filter((entry) => entry.id !== operation.entryId);
  }
  return next;
}

function expenseFromOperation(
  data: ExpensesResponse,
  operation: Extract<OfflineMutationOperation, { kind: 'expense_create' }>,
): Expense {
  const now = new Date().toISOString();
  const day = data.days.find((candidate) => candidate.date === operation.input.localDate) ?? null;
  const item =
    data.itineraryItems.find((candidate) => candidate.id === operation.input.itineraryItemId) ??
    null;
  const place =
    data.tripPlaces.find((candidate) => candidate.id === operation.input.tripPlaceId) ?? null;
  return {
    ...operation.input,
    createdAt: now,
    id: operation.clientExpenseId,
    itineraryDay: day ? { date: day.date, id: day.id } : null,
    itineraryItem: item,
    timeZone: null,
    timeZoneSource: null,
    tripPlace: place,
    updatedAt: now,
  };
}

function expenseTotals(expenses: Expense[]) {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    const currencyCode = expense.currencyCode.trim().toUpperCase();
    const amount = Number(expense.amount);
    if (!currencyCode || !Number.isFinite(amount)) continue;
    totals.set(currencyCode, (totals.get(currencyCode) ?? 0) + amount);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, amount]) => ({ amount: amount.toFixed(2), currencyCode }));
}

function applyExpenseInput(data: ExpensesResponse, expense: Expense, input: ExpenseInput) {
  Object.assign(expense, input, { updatedAt: new Date().toISOString() });
  if (input.localDate !== undefined) {
    const day = data.days.find((candidate) => candidate.date === input.localDate);
    expense.itineraryDay = day ? { date: day.date, id: day.id } : null;
  }
  if (input.itineraryItemId !== undefined) {
    expense.itineraryItem =
      data.itineraryItems.find((candidate) => candidate.id === input.itineraryItemId) ?? null;
  }
  if (input.tripPlaceId !== undefined) {
    expense.tripPlace =
      data.tripPlaces.find((candidate) => candidate.id === input.tripPlaceId) ?? null;
  }
}

function refreshExpenseTotals(data: ExpensesResponse) {
  data.actualSpend = expenseTotals(data.expenses);
  for (const day of data.days) {
    day.actualSpend = expenseTotals(
      data.expenses.filter((expense) => expense.itineraryDay?.id === day.id),
    );
  }
}

function applyExpenseOperation(data: ExpensesResponse, operation: OfflineMutationOperation) {
  const next = structuredClone(data);
  if (operation.kind === 'expense_create') {
    const expense = next.expenses.find((candidate) => candidate.id === operation.clientExpenseId);
    if (expense) {
      applyExpenseInput(next, expense, operation.input);
    } else {
      next.expenses.unshift(expenseFromOperation(next, operation));
    }
  } else if (operation.kind === 'expense_update') {
    const expense = next.expenses.find((candidate) => candidate.id === operation.expenseId);
    if (expense) applyExpenseInput(next, expense, operation.input);
  } else if (operation.kind === 'expense_delete') {
    next.expenses = next.expenses.filter((expense) => expense.id !== operation.expenseId);
  }
  refreshExpenseTotals(next);
  return next;
}

/**
 * The trip-local capture time is the server's to resolve. This local preview uses
 * the same day/item/trip context the server will read, so what the traveller sees
 * offline matches what is stored once the capture syncs.
 */
function localCapture(instant: Date, timeZone: string) {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: zone,
      year: 'numeric',
    }).formatToParts(instant);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone);
  } catch {
    parts = format('UTC');
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    time: `${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

/**
 * Mirrors the order the server resolves a Memory's timezone in: the itinerary
 * item, then the Place, then the day, then the trip reference. A queued capture
 * therefore previews on the story day it will actually land on, instead of
 * jumping to another day once it syncs.
 */
function queuedMemoryTimeZone(
  itinerary: Itinerary | null,
  day: Itinerary['days'][number] | undefined,
  item: ItineraryItem | undefined,
  tripPlace: Itinerary['tripPlaces'][number] | undefined,
) {
  if (item?.timeZone) return { source: 'itinerary_item', timeZone: item.timeZone };
  if (tripPlace?.place.timeZone) {
    return { source: 'trip_place', timeZone: tripPlace.place.timeZone };
  }
  if (day) return { source: 'itinerary_day', timeZone: day.defaultTimeZone };
  return { source: 'trip_reference', timeZone: itinerary?.trip.referenceTimeZone ?? 'UTC' };
}

function memoryFromOperation(
  snapshot: OfflineTripSnapshot,
  operation: Extract<OfflineMutationOperation, { kind: 'memory_create' }>,
): Memory {
  const itinerary = snapshot.itinerary;
  const day = itinerary?.days.find((candidate) => candidate.id === operation.input.itineraryDayId);
  const item = day?.items.find((candidate) => candidate.id === operation.input.itineraryItemId);
  const tripPlace = itinerary?.tripPlaces.find(
    (candidate) => candidate.id === operation.input.tripPlaceId,
  );
  const { source, timeZone } = queuedMemoryTimeZone(itinerary, day, item, tripPlace);
  const now = new Date();
  const capturedAt = operation.input.capturedAt ?? now.toISOString();
  const local = localCapture(new Date(capturedAt), timeZone);

  return {
    capturedAt,
    capturedLocalDate: local.date,
    capturedLocalTime: local.time,
    createdAt: now.toISOString(),
    highlightPosition: null,
    id: operation.clientMemoryId,
    isHighlight: operation.input.isHighlight ?? false,
    itineraryDay: day ? { date: day.date, id: day.id } : null,
    itineraryItem: item ? { id: item.id, label: item.customLabel } : null,
    note: operation.input.note?.trim() || null,
    photos: [],
    timeZone,
    timeZoneSource: source,
    tripPlace: tripPlace
      ? {
          id: tripPlace.id,
          kind: tripPlace.place.kind,
          name: tripPlace.place.kind === 'custom' ? tripPlace.place.name : null,
          placeId: tripPlace.place.id,
          providerRefs: tripPlace.place.providerRefs.map((reference) => ({
            externalPlaceId: reference.externalPlaceId,
            provider: reference.provider,
          })),
          // Carried through so a Memory captured offline names its Place the
          // same way one that synced does.
          snapshot: tripPlace.place.snapshot,
        }
      : null,
    updatedAt: now.toISOString(),
  };
}

function applyMemoryOperation(
  snapshot: OfflineTripSnapshot,
  data: MemoriesResponse,
  operation: OfflineMutationOperation,
): MemoriesResponse {
  const next = { ...data, memories: [...data.memories] };
  if (operation.kind === 'memory_create') {
    if (next.memories.some((memory) => memory.id === operation.clientMemoryId)) return next;
    next.memories = [...next.memories, memoryFromOperation(snapshot, operation)];
    return next;
  }
  if (operation.kind === 'memory_photo_create') {
    next.memories = next.memories.map((memory) => {
      if (memory.id !== operation.clientMemoryId) return memory;
      if (memory.photos.some((photo) => photo.id === operation.clientPhotoId)) return memory;
      return {
        ...memory,
        photos: [
          ...memory.photos,
          {
            contentType: operation.contentType,
            createdAt: new Date().toISOString(),
            fileName: operation.fileName,
            id: operation.clientPhotoId,
            position: memory.photos.length,
            sizeBytes: operation.sizeBytes,
            url: null,
          },
        ],
      };
    });
    return next;
  }
  if (operation.kind === 'memory_delete') {
    next.memories = next.memories.filter((memory) => memory.id !== operation.memoryId);
  }
  return next;
}

export async function mergeQueuedMemories(
  userId: string,
  tripId: string,
  data: MemoriesResponse,
  snapshot: OfflineTripSnapshot,
) {
  const mutations = await listUserMutations(userId, tripId);
  return mutations.reduce(
    (current, mutation) =>
      mutation.operation.kind.startsWith('memory_')
        ? applyMemoryOperation(snapshot, current, mutation.operation)
        : current,
    data,
  );
}

function applyOperationToSnapshot(
  snapshot: OfflineTripSnapshot,
  operation: OfflineMutationOperation,
): Partial<OfflineTripSnapshot> {
  if (isItineraryOperation(operation)) {
    return snapshot.itinerary
      ? { itinerary: applyOfflineMutation(snapshot.itinerary, operation) }
      : {};
  }
  if (operation.kind.startsWith('task_')) {
    return snapshot.tasks ? { tasks: applyTaskOperation(snapshot.tasks, operation) } : {};
  }
  if (operation.kind.startsWith('trip_info_')) {
    return snapshot.tripInfo
      ? { tripInfo: applyTripInfoOperation(snapshot.tripInfo, operation) }
      : {};
  }
  if (operation.kind.startsWith('expense_')) {
    return snapshot.expenses
      ? { expenses: applyExpenseOperation(snapshot.expenses, operation) }
      : {};
  }
  return {};
}

export async function applyMutationToStoredItinerary(
  userId: string,
  tripId: string,
  operation: OfflineItineraryMutationOperation,
) {
  const snapshot = await readTripSnapshot(userId, tripId);
  if (!snapshot?.itinerary) throw new Error('offline_trip_not_prepared');
  await writeSnapshot({
    ...snapshot,
    itinerary: applyOfflineMutation(snapshot.itinerary, operation),
    savedAt: new Date().toISOString(),
  });
}

/**
 * The three operations the read cache persister needs, over the `query-cache`
 * store. Kept here rather than in `lib/query` so every reader and writer of the
 * offline database goes through one module, and so a wipe cannot miss the store.
 */
export async function readQueryCacheEntry(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction(QUERY_CACHE_STORE, 'readonly');
  const record = await requestResult(
    transaction.objectStore(QUERY_CACHE_STORE).get(key) as IDBRequest<
      { key: string; value: string } | undefined
    >,
  );
  return record?.value ?? null;
}

export async function writeQueryCacheEntry(key: string, value: string) {
  const database = await openDatabase();
  const transaction = database.transaction(QUERY_CACHE_STORE, 'readwrite');
  transaction.objectStore(QUERY_CACHE_STORE).put({ key, value });
  await transactionDone(transaction);
}

export async function deleteQueryCacheEntry(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction(QUERY_CACHE_STORE, 'readwrite');
  transaction.objectStore(QUERY_CACHE_STORE).delete(key);
  await transactionDone(transaction);
}
