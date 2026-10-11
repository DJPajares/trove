'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { ExpenseEditorSheet } from '@/components/expenses/expense-editor-sheet';
import { usePreferences } from '@/components/preferences-provider';
import { useTripContext } from '@/components/trip-provider';
import { createExpense, fetchExpenses, type ExpenseInput } from '@/lib/expenses/api';
import {
  createBudgetForm,
  createExpenseForm,
  hasValidMoney,
  type EditorState,
  type ExpenseForm,
} from '@/lib/expenses/editor-state';
import { queryKeys } from '@/lib/query/keys';

type OpenExpenseOptions = {
  /** The stop the money was spent at; its place is carried into the form. */
  itineraryItemId?: string;
  localDate?: string;
  onSaved?: () => void;
};

type TripModeExpenseContextValue = {
  openCreate: (options?: OpenExpenseOptions) => void;
};

const TripModeExpenseContext = createContext<TripModeExpenseContextValue>({
  openCreate: () => undefined,
});

export function useTripModeExpense() {
  return useContext(TripModeExpenseContext);
}

/**
 * Logging what something cost without leaving Trip Mode.
 *
 * The Expenses page's own sheet, opened over whichever Trip Mode view asked for
 * it, for adding only - editing, deleting and the budget stay on that page. The
 * expenses resource is asked for the first time the sheet opens, never before,
 * so Trip Mode costs nothing for a traveller who never logs a coffee.
 */
export function TripModeExpenseProvider({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const t = useTranslations('expenses');
  const { preferredCurrency } = usePreferences();
  const trip = useTripContext()?.trip ?? null;
  const queryClient = useQueryClient();
  const [requested, setRequested] = useState(false);
  // The same entry the Expenses page and Trip's tools read, so one answer
  // serves all three - and nothing is asked for until the sheet is wanted.
  const { data } = useQuery({
    enabled: requested,
    queryFn: () => fetchExpenses(tripId),
    queryKey: queryKeys.expenses(tripId),
  });
  // Bumped on every open, so an open with the expenses already in hand still
  // runs the effect that fills the form.
  const [openCount, setOpenCount] = useState(0);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed', expense: null });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(() => createExpenseForm(null, null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What the sheet was opened for, until the expenses it needs have arrived.
  const pendingRef = useRef<OpenExpenseOptions | null>(null);
  const onSavedRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || !data) return;
    pendingRef.current = null;
    const draft = createExpenseForm(null, data.budget, preferredCurrency);
    if (pending.localDate && /^\d{4}-\d{2}-\d{2}$/.test(pending.localDate)) {
      draft.localDate = pending.localDate;
    }
    // The form has no itinerary-item field of its own; the stop's place is the
    // same answer to where the money went, as the Expenses page's quick add does.
    const placeId = pending.itineraryItemId
      ? (data.itineraryItems.find((item) => item.id === pending.itineraryItemId)?.place?.id ?? null)
      : null;
    if (placeId) draft.tripPlaceId = placeId;
    setExpenseForm(draft);
    setFormError(null);
    setEditor({ kind: 'create', expense: null });
  }, [data, openCount, preferredCurrency]);

  const openCreate = useCallback((options: OpenExpenseOptions = {}) => {
    pendingRef.current = options;
    onSavedRef.current = options.onSaved;
    setRequested(true);
    setOpenCount((count) => count + 1);
  }, []);

  function close() {
    setEditor({ kind: 'closed', expense: null });
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasValidMoney(expenseForm.amount, expenseForm.currencyCode)) {
      setFormError(t('amountCurrencyRequired'));
      return;
    }
    const input: ExpenseInput = {
      amount: expenseForm.amount,
      category: expenseForm.category === 'none' ? null : expenseForm.category,
      currencyCode: expenseForm.currencyCode.toUpperCase(),
      itineraryItemId: expenseForm.itineraryItemId === 'none' ? null : expenseForm.itineraryItemId,
      localDate: expenseForm.localDate || null,
      localTime: expenseForm.localTime || null,
      note: expenseForm.note.trim() || null,
      title: expenseForm.title.trim() || null,
      tripPlaceId: expenseForm.tripPlaceId === 'none' ? null : expenseForm.tripPlaceId,
    };
    setSaving(true);
    setFormError(null);
    try {
      await createExpense(tripId, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.expenses(tripId) }),
        queryClient.invalidateQueries({ queryKey: ['trip-overview', tripId] }),
      ]);
      close();
      onSavedRef.current?.();
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const value = useMemo(() => ({ openCreate }), [openCreate]);

  return (
    <TripModeExpenseContext.Provider value={value}>
      {children}
      {data ? (
        <ExpenseEditorSheet
          budgetForm={createBudgetForm(null)}
          deleting={false}
          editor={editor}
          expenseForm={expenseForm}
          expenseToDelete={null}
          formError={formError}
          onBudgetFieldChange={() => undefined}
          onBudgetSubmit={(event) => event.preventDefault()}
          onClose={close}
          onConfirmDelete={() => undefined}
          onExpenseFieldChange={(key, fieldValue) => {
            setExpenseForm((current) => ({ ...current, [key]: fieldValue }));
            setFormError(null);
          }}
          onExpenseSubmit={(event) => void handleSubmit(event)}
          onExpenseToDeleteChange={() => undefined}
          saving={saving}
          tripEndDate={trip?.endDate ?? ''}
          tripPlaces={data.tripPlaces}
          tripStartDate={trip?.startDate ?? ''}
        />
      ) : null}
    </TripModeExpenseContext.Provider>
  );
}
