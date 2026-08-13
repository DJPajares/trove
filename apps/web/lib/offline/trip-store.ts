import type {
  Itinerary,
  ItineraryDayRoutes,
  ItineraryItem,
  ItineraryItemInput,
  ItineraryScheduleInput,
  ItineraryTravelStatus,
} from '@/lib/itinerary/api';
import type { Expense, ExpenseInput, ExpensesResponse } from '@/lib/expenses/api';
import type { ReservationsResponse } from '@/lib/reservations/api';
import type { Task, TaskInput, TasksResponse } from '@/lib/tasks/api';
import type { TripInfoEntry, TripInfoInput, TripInfoResponse } from '@/lib/trip-info/api';
import type { Trip } from '@/lib/trips/api';

const DATABASE_NAME = 'trove-offline';
const DATABASE_VERSION = 2;
const SNAPSHOT_STORE = 'trip-snapshots';
const MUTATION_STORE = 'mutations';
const DOCUMENT_STORE = 'reservation-documents';
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
  | { baseExpense: Expense; expenseId: string; kind: 'expense_delete' };

export type OfflineSupportingSnapshotKey =
  'expenses' | 'reservations' | 'routes' | 'tasks' | 'tripInfo';

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

export type OfflineSupportingMutationOperation = Exclude<
  OfflineMutationOperation,
  OfflineItineraryMutationOperation
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

export type OfflineTripSnapshot = {
  expenses: ExpensesResponse | null;
  itinerary: Itinerary | null;
  key: string;
  lastPreparationAttemptAt: string | null;
  preparationError: string | null;
  preparedAt: string | null;
  reservations: ReservationsResponse | null;
  routes: Record<string, ItineraryDayRoutes>;
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
      [SNAPSHOT_STORE, MUTATION_STORE, DOCUMENT_STORE],
      'readwrite',
    );
    transaction.objectStore(SNAPSHOT_STORE).clear();
    transaction.objectStore(MUTATION_STORE).clear();
    transaction.objectStore(DOCUMENT_STORE).clear();
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
        .filter((cacheName) => cacheName.includes('trove-pwa-trip-mode'))
        .map((cacheName) => caches.delete(cacheName)),
    );
  }
  announceChange();
}

export async function removeTripOfflineData(userId: string, tripId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOT_STORE, MUTATION_STORE, DOCUMENT_STORE],
    'readwrite',
  );
  const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
  const mutationStore = transaction.objectStore(MUTATION_STORE);
  const documentStore = transaction.objectStore(DOCUMENT_STORE);
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
  if (input.notes !== undefined) item.notes = input.notes?.trim() || null;
  if (input.plannedCost !== undefined) item.plannedCost = input.plannedCost;
  if (input.priority !== undefined) item.priority = input.priority;
  if (input.tripPlaceId !== undefined) {
    item.tripPlace = input.tripPlaceId
      ? (itinerary?.tripPlaces.find((candidate) => candidate.id === input.tripPlaceId) ?? null)
      : null;
  }
  if (input.schedule) applySchedule(item, input.schedule);
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
    applyInput(item, mutation.input, next);
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
