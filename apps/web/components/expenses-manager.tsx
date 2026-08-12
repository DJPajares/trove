'use client';

import {
  ArrowLeft,
  CircleAlert,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { DatePicker } from '@/components/date-picker';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createExpense,
  deleteExpense,
  fetchExpenses,
  updateBudget,
  updateExpense,
  type CurrencyTotal,
  type Expense,
  type ExpenseCategory,
  type ExpenseInput,
  type ExpensesResponse,
} from '@/lib/expenses/api';

type EditorState =
  | { kind: 'closed'; expense: null }
  | { kind: 'create'; expense: null }
  | { kind: 'edit'; expense: Expense }
  | { kind: 'budget'; expense: null };

type ExpenseForm = {
  amount: string;
  category: ExpenseCategory | 'none';
  currencyCode: string;
  itineraryItemId: string;
  localDate: string;
  localTime: string;
  note: string;
  title: string;
  tripPlaceId: string;
};

type BudgetForm = { amount: string; currencyCode: string };

const categories: ExpenseCategory[] = [
  'food',
  'transport',
  'stay',
  'activities',
  'shopping',
  'other',
];

function createExpenseForm(expense: Expense | null, budget: CurrencyTotal | null): ExpenseForm {
  return {
    amount: expense?.amount ?? '',
    category: expense?.category ?? 'none',
    currencyCode: expense?.currencyCode ?? budget?.currencyCode ?? '',
    itineraryItemId: expense?.itineraryItem?.id ?? 'none',
    localDate: expense?.localDate ?? '',
    localTime: expense?.localTime ?? '',
    note: expense?.note ?? '',
    title: expense?.title ?? '',
    tripPlaceId: expense?.tripPlace?.id ?? 'none',
  };
}

function createBudgetForm(budget: CurrencyTotal | null): BudgetForm {
  return { amount: budget?.amount ?? '', currencyCode: budget?.currencyCode ?? '' };
}

function hasValidMoney(amount: string, currencyCode: string) {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amount) && /^[A-Za-z]{3}$/.test(currencyCode);
}

export function ExpensesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('expenses');
  const locale = useLocale();
  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed', expense: null });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(() => createExpenseForm(null, null));
  const [budgetForm, setBudgetForm] = useState<BudgetForm>(() => createBudgetForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchExpenses(tripId));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function closeEditor() {
    setEditor({ kind: 'closed', expense: null });
    setFormError(null);
  }

  function openCreate() {
    setExpenseForm(createExpenseForm(null, data?.budget ?? null));
    setFormError(null);
    setEditor({ kind: 'create', expense: null });
  }

  function openEdit(expense: Expense) {
    setExpenseForm(createExpenseForm(expense, data?.budget ?? null));
    setFormError(null);
    setEditor({ kind: 'edit', expense });
  }

  function openBudget() {
    setBudgetForm(createBudgetForm(data?.budget ?? null));
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

  const currencyFormatter = useMemo(
    () => (total: CurrencyTotal) => {
      try {
        return new Intl.NumberFormat(locale, {
          currency: total.currencyCode,
          currencyDisplay: 'code',
          style: 'currency',
        }).format(Number(total.amount));
      } catch {
        return `${total.currencyCode} ${total.amount}`;
      }
    },
    [locale],
  );

  if (status === 'loading') {
    return <PageState className="mx-auto max-w-5xl" kind="loading" title={t('loading')} />;
  }
  if (status === 'error' || !data) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        className="mx-auto max-w-5xl"
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
    .filter((day) => day.expenses.length > 0 || day.projectedCost.length > 0);

  const totals = (values: CurrencyTotal[], empty: string) =>
    values.length ? values.map(currencyFormatter).join(', ') : empty;

  const expenseTitle = (expense: Expense) => expense.title ?? t('untitledExpense');

  const renderExpense = (expense: Expense) => (
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
          <span className="shrink-0 text-sm font-semibold">
            {currencyFormatter({ amount: expense.amount, currencyCode: expense.currencyCode })}
          </span>
        </div>
        <ItemDescription className="line-clamp-none">
          <span className="flex flex-wrap gap-x-2 gap-y-1">
            {expense.category ? <span>{t(`categories.${expense.category}`)}</span> : null}
            {expense.tripPlace?.name ? <span>{expense.tripPlace.name}</span> : null}
            {expense.itineraryItem?.label ? <span>{expense.itineraryItem.label}</span> : null}
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

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader
        actions={
          <>
            <Button nativeButton={false} render={<Link href="/trips" />} variant="ghost">
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('backToTrips')}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addExpense')}
            </Button>
          </>
        }
        description={t('description')}
        title={t('title', { trip: data.trip.name })}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-label={t('title', { trip: data.trip.name })}
        className="border-y border-border py-5"
      >
        <dl className="grid gap-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
          <div className="space-y-1 sm:px-5 sm:first:pl-0">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-sm font-medium">{t('budget')}</dt>
              <Button onClick={openBudget} size="sm" variant="ghost">
                {data.budget ? t('editBudget') : t('setBudget')}
              </Button>
            </div>
            <dd className="text-lg font-semibold tracking-tight">
              {data.budget ? currencyFormatter(data.budget) : t('budgetNotSet')}
            </dd>
            <p className="text-sm text-muted-foreground">{t('budgetDescription')}</p>
          </div>
          <div className="space-y-1 sm:px-5">
            <dt className="text-sm font-medium">{t('projectedCost')}</dt>
            <dd className="text-lg font-semibold tracking-tight">
              {totals(data.projectedCost, t('noProjectedCost'))}
            </dd>
            <p className="text-sm text-muted-foreground">{t('projectedCostDescription')}</p>
          </div>
          <div className="space-y-1 sm:px-5 sm:last:pr-0">
            <dt className="text-sm font-medium">{t('actualSpend')}</dt>
            <dd className="text-lg font-semibold tracking-tight">
              {totals(data.actualSpend, t('noActualSpend'))}
            </dd>
            <p className="text-sm text-muted-foreground">{t('actualSpendDescription')}</p>
          </div>
        </dl>
      </section>

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
            <section
              aria-label={t('dayActualSpend', { date: day.date })}
              className="space-y-3"
              key={day.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold tracking-tight">{day.date}</h2>
                <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm font-medium text-muted-foreground">
                  <p>
                    {t('dayActualSummary', { total: totals(day.actualSpend, t('noActualSpend')) })}
                  </p>
                  <p>
                    {t('dayProjectedSummary', {
                      total: totals(day.projectedCost, t('noProjectedCost')),
                    })}
                  </p>
                </div>
              </div>
              {day.expenses.length ? (
                <ItemGroup aria-label={t('expenseList')} variant="list">
                  {day.expenses.map(renderExpense)}
                </ItemGroup>
              ) : null}
            </section>
          ))}
          {unassignedExpenses.length ? (
            <section aria-label={t('tripLevelExpenses')} className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t('tripLevelExpenses')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('tripLevelExpensesDescription')}
                </p>
              </div>
              <ItemGroup aria-label={t('tripLevelExpenses')} variant="list">
                {unassignedExpenses.map(renderExpense)}
              </ItemGroup>
            </section>
          ) : null}
        </div>
      )}

      <Sheet onOpenChange={(open) => !open && closeEditor()} open={editor.kind !== 'closed'}>
        <SheetContent
          className="data-[side=right]:w-[min(42rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>
              {editor.kind === 'budget'
                ? t('budgetTitle')
                : editor.kind === 'edit'
                  ? t('editTitle')
                  : t('createTitle')}
            </SheetTitle>
            <SheetDescription>
              {editor.kind === 'budget'
                ? t('budgetDescriptionEditor')
                : editor.kind === 'edit'
                  ? t('editDescription')
                  : t('createDescription')}
            </SheetDescription>
          </SheetHeader>

          {editor.kind === 'budget' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleBudgetSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <FieldGroup>
                  {formError ? (
                    <Alert role="alert" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field>
                      <FieldLabel htmlFor="budget-amount">{t('amount')}</FieldLabel>
                      <Input
                        id="budget-amount"
                        inputMode="decimal"
                        onChange={(event) => updateBudgetForm('amount', event.target.value)}
                        placeholder={t('amountPlaceholder')}
                        value={budgetForm.amount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="budget-currency">{t('currency')}</FieldLabel>
                      <Input
                        id="budget-currency"
                        maxLength={3}
                        onChange={(event) =>
                          updateBudgetForm('currencyCode', event.target.value.toUpperCase())
                        }
                        placeholder={t('currencyPlaceholder')}
                        value={budgetForm.currencyCode}
                      />
                    </Field>
                  </div>
                </FieldGroup>
              </div>
              <SheetFooter>
                <Button onClick={closeEditor} type="button" variant="outline">
                  {t('cancel')}
                </Button>
                <Button disabled={saving} type="submit">
                  {saving
                    ? t('saving')
                    : budgetForm.amount || budgetForm.currencyCode
                      ? t('saveBudget')
                      : t('clearBudget')}
                </Button>
              </SheetFooter>
            </form>
          ) : editor.kind !== 'closed' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleExpenseSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <FieldGroup>
                  {formError ? (
                    <Alert role="alert" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field>
                      <FieldLabel htmlFor="expense-amount">{t('amount')}</FieldLabel>
                      <Input
                        id="expense-amount"
                        inputMode="decimal"
                        onChange={(event) => updateExpenseForm('amount', event.target.value)}
                        placeholder={t('amountPlaceholder')}
                        required
                        value={expenseForm.amount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-currency">{t('currency')}</FieldLabel>
                      <Input
                        id="expense-currency"
                        maxLength={3}
                        onChange={(event) =>
                          updateExpenseForm('currencyCode', event.target.value.toUpperCase())
                        }
                        placeholder={t('currencyPlaceholder')}
                        required
                        value={expenseForm.currencyCode}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="expense-title">{t('expenseTitle')}</FieldLabel>
                    <Input
                      id="expense-title"
                      maxLength={300}
                      onChange={(event) => updateExpenseForm('title', event.target.value)}
                      placeholder={t('expenseTitlePlaceholder')}
                      value={expenseForm.title}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="expense-category">{t('category')}</FieldLabel>
                    <Select
                      onValueChange={(value) =>
                        updateExpenseForm('category', (value ?? 'none') as ExpenseCategory | 'none')
                      }
                      value={expenseForm.category}
                    >
                      <SelectTrigger id="expense-category" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('noCategory')}</SelectItem>
                        {categories.map((category) => (
                          <SelectItem key={category} value={category}>
                            {t(`categories.${category}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t('date')}</FieldLabel>
                      <DatePicker
                        id="expense-date"
                        label={t('date')}
                        onChange={(value) => updateExpenseForm('localDate', value)}
                        value={expenseForm.localDate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-time">{t('time')}</FieldLabel>
                      <Input
                        id="expense-time"
                        onChange={(event) => updateExpenseForm('localTime', event.target.value)}
                        step="60"
                        type="time"
                        value={expenseForm.localTime}
                      />
                      <FieldDescription>{t('timeHint')}</FieldDescription>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="expense-place">{t('linkedPlace')}</FieldLabel>
                      <Select
                        onValueChange={(value) => updateExpenseForm('tripPlaceId', value ?? 'none')}
                        value={expenseForm.tripPlaceId}
                      >
                        <SelectTrigger id="expense-place" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedPlace')}</SelectItem>
                          {data.tripPlaces.map((place) => (
                            <SelectItem key={place.id} value={place.id}>
                              {place.name ?? t('unnamedPlace')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-item">{t('linkedItem')}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          updateExpenseForm('itineraryItemId', value ?? 'none')
                        }
                        value={expenseForm.itineraryItemId}
                      >
                        <SelectTrigger id="expense-item" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedItem')}</SelectItem>
                          {data.itineraryItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label ?? t('unnamedItem')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="expense-note">{t('note')}</FieldLabel>
                    <Textarea
                      id="expense-note"
                      maxLength={5_000}
                      onChange={(event) => updateExpenseForm('note', event.target.value)}
                      placeholder={t('notePlaceholder')}
                      rows={3}
                      value={expenseForm.note}
                    />
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter>
                {editor.kind === 'edit' ? (
                  <Button
                    className="sm:mr-auto"
                    onClick={() => setExpenseToDelete(editor.expense)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteExpense')}
                  </Button>
                ) : null}
                <Button onClick={closeEditor} type="button" variant="outline">
                  {t('cancel')}
                </Button>
                <Button disabled={saving} type="submit">
                  {saving
                    ? t('saving')
                    : editor.kind === 'edit'
                      ? t('saveChanges')
                      : t('createExpense')}
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        onOpenChange={(open) => !open && setExpenseToDelete(null)}
        open={Boolean(expenseToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                title: expenseToDelete ? expenseTitle(expenseToDelete) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteExpense')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
