import {
  listUserMutations,
  queueOfflineMutation,
  readTripSnapshot,
  type OfflineMutation,
  type OfflineMutationOperation,
  type OfflineSupportingSnapshotKey,
  type OfflineTripSnapshot,
} from './trip-store';

function mergeSupportingOperation(
  existing: OfflineMutationOperation,
  incoming: OfflineMutationOperation,
): OfflineMutationOperation | null {
  if (incoming.kind === 'task_update') {
    if (existing.kind === 'task_create' && existing.clientTaskId === incoming.taskId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
    if (existing.kind === 'task_update' && existing.taskId === incoming.taskId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
  }
  if (
    incoming.kind === 'task_delete' &&
    ((existing.kind === 'task_create' && existing.clientTaskId === incoming.taskId) ||
      (existing.kind === 'task_update' && existing.taskId === incoming.taskId))
  ) {
    return {
      ...incoming,
      baseTask: existing.kind === 'task_update' ? existing.baseTask : incoming.baseTask,
    };
  }

  if (incoming.kind === 'trip_info_update') {
    if (existing.kind === 'trip_info_create' && existing.clientEntryId === incoming.entryId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
    if (existing.kind === 'trip_info_update' && existing.entryId === incoming.entryId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
  }
  if (
    incoming.kind === 'trip_info_delete' &&
    ((existing.kind === 'trip_info_create' && existing.clientEntryId === incoming.entryId) ||
      (existing.kind === 'trip_info_update' && existing.entryId === incoming.entryId))
  ) {
    return {
      ...incoming,
      baseEntry: existing.kind === 'trip_info_update' ? existing.baseEntry : incoming.baseEntry,
    };
  }

  if (incoming.kind === 'expense_update') {
    if (existing.kind === 'expense_create' && existing.clientExpenseId === incoming.expenseId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
    if (existing.kind === 'expense_update' && existing.expenseId === incoming.expenseId) {
      return { ...existing, input: { ...existing.input, ...incoming.input } };
    }
  }
  if (
    incoming.kind === 'expense_delete' &&
    ((existing.kind === 'expense_create' && existing.clientExpenseId === incoming.expenseId) ||
      (existing.kind === 'expense_update' && existing.expenseId === incoming.expenseId))
  ) {
    return {
      ...incoming,
      baseExpense: existing.kind === 'expense_update' ? existing.baseExpense : incoming.baseExpense,
    };
  }

  return null;
}

export function canUseSupportingOfflineFallback(error: unknown) {
  return (
    error instanceof TypeError ||
    (typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status >= 500) ||
    (typeof navigator !== 'undefined' && !navigator.onLine)
  );
}

export function createSupportingMutation(
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

export async function queueSupportingMutation(
  userId: string,
  tripId: string,
  operation: OfflineMutationOperation,
) {
  const mutations = await listUserMutations(userId, tripId);
  for (const mutation of mutations.toReversed()) {
    if (mutation.state !== 'pending') continue;
    const merged = mergeSupportingOperation(mutation.operation, operation);
    if (!merged) continue;
    await queueOfflineMutation({
      ...mutation,
      operation: merged,
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await queueOfflineMutation(createSupportingMutation(userId, tripId, operation));
}

export async function readPreparedSupportingData<Key extends OfflineSupportingSnapshotKey>(
  userId: string,
  tripId: string,
  key: Key,
): Promise<NonNullable<OfflineTripSnapshot[Key]>> {
  const snapshot = await readTripSnapshot(userId, tripId);
  const value = snapshot?.[key];
  if (!value) throw new Error('offline_supporting_data_not_prepared');
  return value as NonNullable<OfflineTripSnapshot[Key]>;
}
