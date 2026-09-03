'use client';

import { CircleAlert, Plus, WalletCards } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { ExpenseEditorSheet } from '@/components/expenses/expense-editor-sheet';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  createExpense,
  deleteExpense,
  fetchExpenses,
  updateBudget,
  updateExpense,
  type Expense,
  type ExpenseInput,
} from '@/lib/expenses/api';
import { ExpenseLedger } from '@/components/expenses/expense-ledger';
import { SpendBreakdowns } from '@/components/expenses/spend-breakdowns';
import { TripSpendPanel } from '@/components/expenses/trip-spend-panel';
import { useSpendReference } from '@/hooks/use-spend-reference';
import { useTripContext } from '@/components/trip-provider';
import { useNowTick } from '@/hooks/use-now-tick';
import { buildSpendBreakdown, type SpendFilter } from '@/lib/expenses/spend-insights';
import { getLocalDate } from '@/lib/trips/lifecycle';
import {
  createBudgetForm,
  createExpenseForm,
  hasValidMoney,
  type BudgetForm,
  type EditorState,
  type ExpenseForm,
} from '@/lib/expenses/editor-state';
import { placeLabel as resolvePlaceLabel } from '@/lib/expenses/labels';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';

export function ExpensesManager({
  quickAdd,
  tripId,
}: Readonly<{
  quickAdd?: { itineraryItemId?: string; localDate?: string };
  tripId: string;
}>) {
  const t = useTranslations('expenses');
  const locale = useLocale();
  const { preferredCurrency } = usePreferences();
  const { data, refresh, status } = useTripResource(queryKeys.expenses(tripId), () =>
    fetchExpenses(tripId),
  );
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed', expense: null });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(() => createExpenseForm(null, null));
  const [budgetForm, setBudgetForm] = useState<BudgetForm>(() => createBudgetForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<SpendFilter | null>(null);
  const quickAddHandled = useRef<string | null>(null);
  const trip = useTripContext()?.trip ?? null;
  const now = useNowTick(true);
  // Resolved here as well as in the panel so the headline and the bars below it
  // are always expressed in the same currency; react-query serves both from one
  // board request.
  const { board, reference } = useSpendReference(data?.actualSpend ?? [], data?.budget ?? null);

  useEffect(() => {
    if (!quickAdd) {
      quickAddHandled.current = null;
      return;
    }
    if (!data) return;
    const quickAddKey = `${quickAdd.localDate ?? ''}:${quickAdd.itineraryItemId ?? ''}`;
    if (quickAddHandled.current === quickAddKey) return;
    quickAddHandled.current = quickAddKey;
    const draft = createExpenseForm(null, data.budget, preferredCurrency);
    if (quickAdd.localDate && /^\d{4}-\d{2}-\d{2}$/.test(quickAdd.localDate)) {
      draft.localDate = quickAdd.localDate;
    }
    if (
      quickAdd.itineraryItemId &&
      data.itineraryItems.some((item) => item.id === quickAdd.itineraryItemId)
    ) {
      draft.itineraryItemId = quickAdd.itineraryItemId;
    }
    setExpenseForm(draft);
    setFormError(null);
    setEditor({ kind: 'create', expense: null });
  }, [data, preferredCurrency, quickAdd]);

  function closeEditor() {
    setEditor({ kind: 'closed', expense: null });
    setFormError(null);
  }

  function openCreate() {
    setExpenseForm(createExpenseForm(null, data?.budget ?? null, preferredCurrency));
    setFormError(null);
    setEditor({ kind: 'create', expense: null });
  }

  function openEdit(expense: Expense) {
    setExpenseForm(createExpenseForm(expense, data?.budget ?? null));
    setFormError(null);
    setEditor({ kind: 'edit', expense });
  }

  function openBudget() {
    setBudgetForm(createBudgetForm(data?.budget ?? null, preferredCurrency));
    setFormError(null);
    setEditor({ kind: 'budget', expense: null });
  }

  function updateExpenseForm<Key extends keyof ExpenseForm>(key: Key, value: ExpenseForm[Key]) {
    setExpenseForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function updateBudgetForm<Key extends keyof BudgetForm>(key: Key, value: BudgetForm[Key]) {
    setBudgetForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  async function handleExpenseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasValidMoney(expenseForm.amount, expenseForm.currencyCode)) {
      setFormError(t('amountCurrencyRequired'));
      return;
    }
    if (expenseForm.localTime && !expenseForm.localDate) {
      setFormError(t('dateRequiredForTime'));
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
      if (editor.kind === 'create') {
        await createExpense(tripId, input);
      } else if (editor.kind === 'edit') {
        await updateExpense(tripId, editor.expense.id, input);
      }
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleBudgetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasValue = Boolean(budgetForm.amount || budgetForm.currencyCode);
    if (hasValue && !hasValidMoney(budgetForm.amount, budgetForm.currencyCode)) {
      setFormError(t('amountCurrencyRequired'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await updateBudget(
        tripId,
        hasValue
          ? { amount: budgetForm.amount, currencyCode: budgetForm.currencyCode.toUpperCase() }
          : null,
      );
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('budgetSaveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!expenseToDelete) return;
    setDeleting(true);
    try {
      await deleteExpense(tripId, expenseToDelete.id);
      setExpenseToDelete(null);
      closeEditor();
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  if (status === 'loading') {
    return <PageState kind="loading" loadingShape="list" title={t('loading')} />;
  }
  if (status === 'error' || !data) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const breakdown = reference
    ? buildSpendBreakdown({
        board,
        days: data.days,
        expenses: data.expenses,
        referenceCurrency: reference.code,
        today: trip ? getLocalDate(now, trip.referenceTimeZone) : null,
      })
    : null;

  const filterLabel = (() => {
    if (!filter) return null;
    if (filter.kind === 'currency') return filter.value;
    if (filter.kind === 'category') {
      return filter.value === 'uncategorised' ? t('noCategory') : t(`categories.${filter.value}`);
    }
    if (filter.kind === 'day') {
      const day = data.days.find((candidate) => candidate.id === filter.value);
      return day
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date(`${day.date}T00:00:00.000Z`),
          )
        : null;
    }
    const place = data.tripPlaces.find((candidate) => candidate.id === filter.value);
    return resolvePlaceLabel(place ?? null, t('unnamedPlace'));
  })();

  return (
    <section className="space-y-7">
      <TripSectionHeader
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addExpense')}
          </Button>
        }
        currentSection="expenses"
        description={t('description')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <TripSpendPanel
        actualSpend={data.actualSpend}
        budget={data.budget}
        onEditBudget={openBudget}
      />

      {data.expenses.length === 0 ? (
        <PageState
          actions={
            <Button onClick={openCreate} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstExpense')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<WalletCards aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      ) : (
        <>
          {breakdown && reference ? (
            <SpendBreakdowns
              breakdown={breakdown}
              currencyCode={reference.code}
              filter={filter}
              onFilterChange={setFilter}
              tripPlaces={data.tripPlaces}
            />
          ) : null}

          <ExpenseLedger
            days={data.days}
            expenses={data.expenses}
            filter={filter}
            filterLabel={filterLabel}
            onClearFilter={() => setFilter(null)}
            onEdit={openEdit}
          />
        </>
      )}

      <ExpenseEditorSheet
        budgetForm={budgetForm}
        deleting={deleting}
        editor={editor}
        expenseForm={expenseForm}
        expenseToDelete={expenseToDelete}
        formError={formError}
        itineraryItems={data.itineraryItems}
        onBudgetFieldChange={updateBudgetForm}
        onBudgetSubmit={handleBudgetSubmit}
        onClose={closeEditor}
        onConfirmDelete={() => void handleDelete()}
        onExpenseFieldChange={updateExpenseForm}
        onExpenseSubmit={handleExpenseSubmit}
        onExpenseToDeleteChange={setExpenseToDelete}
        saving={saving}
        tripPlaces={data.tripPlaces}
      />
    </section>
  );
}
