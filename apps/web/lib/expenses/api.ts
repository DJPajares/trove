import {
  canUseSupportingOfflineFallback,
  queueSupportingMutation,
  readPreparedSupportingData,
} from '@/lib/offline/supporting-sync';
import {
  saveSupportingSnapshot,
  setOfflineApiReachable,
  type OfflineMutationOperation,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

export type ExpenseCategory = 'activities' | 'food' | 'other' | 'shopping' | 'stay' | 'transport';

export type CurrencyTotal = { amount: string; currencyCode: string };

/** A provider Place arrives unnamed; the reference is what resolves it on demand. */
export type ExpensePlace = {
  id: string;
  kind: 'custom' | 'provider';
  name: string | null;
  placeId: string;
  providerRefs: Array<{ externalPlaceId: string; provider: 'google' }>;
};

export type Expense = {
  amount: string;
  category: ExpenseCategory | null;
  createdAt: string;
  currencyCode: string;
  id: string;
  itineraryDay: { date: string; id: string } | null;
  itineraryItem: { id: string; label: string | null; place: ExpensePlace | null } | null;
  localDate: string | null;
  localTime: string | null;
  note: string | null;
  timeZone: string | null;
  timeZoneSource: 'itinerary_day' | 'itinerary_item' | 'trip_place' | 'trip_reference' | null;
  title: string | null;
  tripPlace: ExpensePlace | null;
  updatedAt: string;
};

export type ExpenseInput = {
  amount: string;
  category: ExpenseCategory | null;
  currencyCode: string;
  itineraryItemId: string | null;
  localDate: string | null;
  localTime: string | null;
  note: string | null;
  title: string | null;
  tripPlaceId: string | null;
};

export type ExpensesResponse = {
  actualSpend: CurrencyTotal[];
  budget: CurrencyTotal | null;
  days: Array<{
    actualSpend: CurrencyTotal[];
    date: string;
    id: string;
    projectedCost: CurrencyTotal[];
  }>;
  expenses: Expense[];
  itineraryItems: Array<{ id: string; label: string | null; place: ExpensePlace | null }>;
  projectedCost: CurrencyTotal[];
  trip: { id: string; name: string };
  tripPlaces: ExpensePlace[];
};

export class ExpensesApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function getAuthContext() {
  try {
    return await getOfflineAuthContext();
  } catch {
    throw new ExpensesApiError('not_authenticated', 401);
  }
}

async function expenseRequest<T>(
  path: string,
  init: RequestInit | undefined,
  auth: Awaited<ReturnType<typeof getAuthContext>>,
) {
  if (!auth.accessToken) throw new ExpensesApiError('offline_session', 503);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        // A JSON content type with no body makes Fastify reject the request, so this
        // is declared only when the request actually carries one.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    setOfflineApiReachable(false);
    throw new ExpensesApiError('expenses_unavailable', 503);
  }
  setOfflineApiReachable(response.status < 500);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new ExpensesApiError(
      body.code ?? `expense_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchExpenses(tripId: string) {
  const auth = await getAuthContext();
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return readPreparedSupportingData(auth.userId, tripId, 'expenses');
  }
  try {
    const data = await expenseRequest<ExpensesResponse>(
      `/trips/${tripId}/expenses`,
      undefined,
      auth,
    );
    await saveSupportingSnapshot(auth.userId, tripId, 'expenses', data);
    return data;
  } catch (error) {
    if (canUseSupportingOfflineFallback(error)) {
      return readPreparedSupportingData(auth.userId, tripId, 'expenses');
    }
    throw error;
  }
}

export async function createExpense(tripId: string, input: ExpenseInput) {
  const auth = await getAuthContext();
  const operation: OfflineMutationOperation = {
    clientExpenseId: crypto.randomUUID(),
    input,
    kind: 'expense_create',
  };
  try {
    const result = await expenseRequest<{ expense: Expense }>(
      `/trips/${tripId}/expenses`,
      {
        body: JSON.stringify({ ...input, clientExpenseId: operation.clientExpenseId }),
        method: 'POST',
      },
      auth,
    );
    const current = await expenseRequest<ExpensesResponse>(
      `/trips/${tripId}/expenses`,
      undefined,
      auth,
    ).catch(() => null);
    if (current) await saveSupportingSnapshot(auth.userId, tripId, 'expenses', current);
    return result;
  } catch (error) {
    if (!canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, operation);
    const data = await readPreparedSupportingData(auth.userId, tripId, 'expenses');
    const expense = data.expenses.find((candidate) => candidate.id === operation.clientExpenseId);
    if (!expense) throw error;
    return { expense };
  }
}

export async function updateExpense(tripId: string, expenseId: string, input: ExpenseInput) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'expenses').catch(
    () => null,
  );
  const baseExpense = stored?.expenses.find((expense) => expense.id === expenseId) ?? null;
  try {
    const result = await expenseRequest<{ expense: Expense }>(
      `/trips/${tripId}/expenses/${expenseId}`,
      { body: JSON.stringify(input), method: 'PATCH' },
      auth,
    );
    const current = await expenseRequest<ExpensesResponse>(
      `/trips/${tripId}/expenses`,
      undefined,
      auth,
    ).catch(() => null);
    if (current) await saveSupportingSnapshot(auth.userId, tripId, 'expenses', current);
    return result;
  } catch (error) {
    if (!baseExpense || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseExpense: structuredClone(baseExpense),
      expenseId,
      input,
      kind: 'expense_update',
    });
    const data = await readPreparedSupportingData(auth.userId, tripId, 'expenses');
    const expense = data.expenses.find((candidate) => candidate.id === expenseId);
    if (!expense) throw error;
    return { expense };
  }
}

export async function deleteExpense(tripId: string, expenseId: string) {
  const auth = await getAuthContext();
  const stored = await readPreparedSupportingData(auth.userId, tripId, 'expenses').catch(
    () => null,
  );
  const baseExpense = stored?.expenses.find((expense) => expense.id === expenseId) ?? null;
  try {
    const result = await expenseRequest<void>(
      `/trips/${tripId}/expenses/${expenseId}`,
      { method: 'DELETE' },
      auth,
    );
    const current = await expenseRequest<ExpensesResponse>(
      `/trips/${tripId}/expenses`,
      undefined,
      auth,
    ).catch(() => null);
    if (current) await saveSupportingSnapshot(auth.userId, tripId, 'expenses', current);
    return result;
  } catch (error) {
    if (!baseExpense || !canUseSupportingOfflineFallback(error)) throw error;
    await queueSupportingMutation(auth.userId, tripId, {
      baseExpense: structuredClone(baseExpense),
      expenseId,
      kind: 'expense_delete',
    });
  }
}

export function updateBudget(tripId: string, budget: CurrencyTotal | null) {
  return getAuthContext().then((auth) =>
    expenseRequest<{ budget: CurrencyTotal | null }>(
      `/trips/${tripId}/expenses/budget`,
      { body: JSON.stringify({ budget }), method: 'PATCH' },
      auth,
    ),
  );
}
