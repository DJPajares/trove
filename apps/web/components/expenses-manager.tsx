'use client';

import { CircleAlert, Pencil, Plus, ReceiptText, WalletCards } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { EditorialSection } from '@/components/editorial-section';
import { ExpenseEditorSheet } from '@/components/expenses/expense-editor-sheet';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  createExpense,
  deleteExpense,
  fetchExpenses,
  updateBudget,
  updateExpense,
  type CurrencyTotal,
  type Expense,
  type ExpenseInput,
  type ExpensePlace,
} from '@/lib/expenses/api';
import { TripSpendPanel } from '@/components/expenses/trip-spend-panel';
import { formatCurrencyAmount } from '@/lib/currency/money';
import {
  createBudgetForm,
  createExpenseForm,
  hasValidMoney,
  type BudgetForm,
  type EditorState,
  type ExpenseForm,
} from '@/lib/expenses/editor-state';
import {
  expenseTitle as resolveExpenseTitle,
  itineraryItemLabel as resolveItemLabel,
  placeLabel as resolvePlaceLabel,
} from '@/lib/expenses/labels';
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
  const quickAddHandled = useRef<string | null>(null);

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

  const currencyFormatter = (total: CurrencyTotal) =>
    formatCurrencyAmount(locale, total.amount, total.currencyCode);

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

  const expensesByDay = new Map<string, Expense[]>();
  const unassignedExpenses: Expense[] = [];
  for (const expense of data.expenses) {
    if (expense.itineraryDay) {
      const values = expensesByDay.get(expense.itineraryDay.id) ?? [];
      values.push(expense);
      expensesByDay.set(expense.itineraryDay.id, values);
    } else {
      unassignedExpenses.push(expense);
    }
  }

  const daySections = data.days
    .map((day) => ({ ...day, expenses: expensesByDay.get(day.id) ?? [] }))
    .filter((day) => day.expenses.length > 0);

  const dateOnly = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );

  const totals = (values: CurrencyTotal[], empty: string) =>
    values.length ? values.map(currencyFormatter).join(', ') : empty;

  const expenseTitle = (expense: Expense) => resolveExpenseTitle(expense, t('untitledExpense'));
  const placeLabel = (place: ExpensePlace | null) => resolvePlaceLabel(place, t('unnamedPlace'));
  const itemLabel = (item: { label: string | null; place: ExpensePlace | null }) =>
    resolveItemLabel(item, t('unnamedItem'));

  const renderExpense = (expense: Expense) => {
    return (
      <Item className="flex-nowrap px-3 py-3" key={expense.id}>
        <ItemMedia
          className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
          variant="icon"
        >
          <ReceiptText aria-hidden="true" />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <ItemTitle className="min-w-0 truncate text-base">{expenseTitle(expense)}</ItemTitle>
            <span className="shrink-0 text-base font-semibold tabular-nums">
              {currencyFormatter({ amount: expense.amount, currencyCode: expense.currencyCode })}
            </span>
          </div>
          <ItemDescription className="line-clamp-none">
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              {expense.category ? <span>{t(`categories.${expense.category}`)}</span> : null}
              {expense.tripPlace ? <span>{placeLabel(expense.tripPlace)}</span> : null}
              {expense.itineraryItem ? <span>{itemLabel(expense.itineraryItem)}</span> : null}
              {expense.localDate && !expense.itineraryDay ? <span>{expense.localDate}</span> : null}
              {expense.localTime ? <span>{expense.localTime}</span> : null}
            </span>
            {!expense.itineraryDay && expense.localDate ? (
              <span className="mt-1 block">{t('unassignedDatedExpense')}</span>
            ) : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="shrink-0">
          <Button
            aria-label={t('editExpense', { title: expenseTitle(expense) })}
            onClick={() => openEdit(expense)}
            size="icon-sm"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
          </Button>
        </ItemActions>
      </Item>
    );
  };

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
        <div className="space-y-7">
          {daySections.map((day) => (
            <EditorialSection
              actions={
                <p className="text-sm font-medium text-muted-foreground">
                  {t('dayActualSummary', { total: totals(day.actualSpend, t('noActualSpend')) })}
                </p>
              }
              key={day.id}
              title={dateOnly(day.date)}
            >
              {day.expenses.length ? (
                <ItemGroup aria-label={t('expenseList')} variant="list">
                  {day.expenses.map(renderExpense)}
                </ItemGroup>
              ) : null}
            </EditorialSection>
          ))}
          {unassignedExpenses.length ? (
            <EditorialSection
              description={t('tripLevelExpensesDescription')}
              title={t('tripLevelExpenses')}
            >
              <ItemGroup aria-label={t('tripLevelExpenses')} variant="list">
                {unassignedExpenses.map(renderExpense)}
              </ItemGroup>
            </EditorialSection>
          ) : null}
        </div>
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
