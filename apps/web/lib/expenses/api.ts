import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type ExpenseCategory = 'activities' | 'food' | 'other' | 'shopping' | 'stay' | 'transport';

export type CurrencyTotal = { amount: string; currencyCode: string };

export type Expense = {
  amount: string;
  category: ExpenseCategory | null;
  createdAt: string;
  currencyCode: string;
  id: string;
  itineraryDay: { date: string; id: string } | null;
  itineraryItem: { id: string; label: string | null } | null;
  localDate: string | null;
  localTime: string | null;
  note: string | null;
  timeZone: string | null;
  timeZoneSource: 'itinerary_day' | 'itinerary_item' | 'trip_place' | 'trip_reference' | null;
  title: string | null;
  tripPlace: { id: string; name: string | null; placeId: string } | null;
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
  itineraryItems: Array<{ id: string; label: string | null }>;
  projectedCost: CurrencyTotal[];
  trip: { id: string; name: string };
  tripPlaces: Array<{ id: string; name: string | null; placeId: string }>;
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

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new ExpensesApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new ExpensesApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function expenseRequest<T>(path: string, init?: RequestInit) {
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
    throw new ExpensesApiError(
      body.code ?? `expense_request_failed_${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function fetchExpenses(tripId: string) {
  return expenseRequest<ExpensesResponse>(`/trips/${tripId}/expenses`);
}

export function createExpense(tripId: string, input: ExpenseInput) {
  return expenseRequest<{ expense: Expense }>(`/trips/${tripId}/expenses`, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateExpense(tripId: string, expenseId: string, input: ExpenseInput) {
  return expenseRequest<{ expense: Expense }>(`/trips/${tripId}/expenses/${expenseId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
  });
}

export function deleteExpense(tripId: string, expenseId: string) {
  return expenseRequest<void>(`/trips/${tripId}/expenses/${expenseId}`, { method: 'DELETE' });
}

export function updateBudget(tripId: string, budget: CurrencyTotal | null) {
  return expenseRequest<{ budget: CurrencyTotal | null }>(`/trips/${tripId}/expenses/budget`, {
    body: JSON.stringify({ budget }),
    method: 'PATCH',
  });
}
