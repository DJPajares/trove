'use client';

import { CircleAlert, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FormEvent } from 'react';

import { CurrencyCombobox } from '@/components/currency-combobox';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { DatePicker } from '@/components/date-picker';
import { MoneyInput } from '@/components/money-input';
import { TimeInput } from '@/components/time-input';
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
import type { Expense, ExpenseCategory, ExpensePlace } from '@/lib/expenses/api';
import { resolveExpenseCategory } from '@/lib/expenses/categories';
import {
  expenseTitle as resolveExpenseTitle,
  itineraryItemLabel as resolveItemLabel,
  placeLabel as resolvePlaceLabel,
} from '@/lib/expenses/labels';
import type { BudgetForm, EditorState, ExpenseForm } from '@/lib/expenses/editor-state';

const categories: ExpenseCategory[] = [
  'food',
  'transport',
  'stay',
  'activities',
  'shopping',
  'other',
];

/**
 * Recording an expense, editing one, and setting the trip budget.
 *
 * All three share one Sheet because they are the same gesture at different
 * scales, and because a traveller correcting a number should never have to
 * work out which of three panels they are supposed to be in.
 */
export function ExpenseEditorSheet({
  budgetForm,
  deleting,
  editor,
  expenseForm,
  expenseToDelete,
  formError,
  itineraryItems,
  onBudgetFieldChange,
  onBudgetSubmit,
  onClose,
  onConfirmDelete,
  onExpenseFieldChange,
  onExpenseSubmit,
  onExpenseToDeleteChange,
  saving,
  tripPlaces,
}: Readonly<{
  budgetForm: BudgetForm;
  deleting: boolean;
  editor: EditorState;
  expenseForm: ExpenseForm;
  expenseToDelete: Expense | null;
  formError: string | null;
  itineraryItems: Array<{ id: string; label: string | null; place: ExpensePlace | null }>;
  onBudgetFieldChange: <Key extends keyof BudgetForm>(key: Key, value: BudgetForm[Key]) => void;
  onBudgetSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onConfirmDelete: () => void;
  onExpenseFieldChange: <Key extends keyof ExpenseForm>(key: Key, value: ExpenseForm[Key]) => void;
  onExpenseSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onExpenseToDeleteChange: (expense: Expense | null) => void;
  saving: boolean;
  tripPlaces: ExpensePlace[];
}>) {
  const t = useTranslations('expenses');

  return (
    <>
      <Sheet onOpenChange={(open) => !open && onClose()} open={editor.kind !== 'closed'}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(42rem,calc(100%-0.5rem))]"
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
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onBudgetSubmit}>
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
                      <MoneyInput
                        id="budget-amount"
                        onValueChange={(value) => onBudgetFieldChange('amount', value)}
                        placeholder={t('amountPlaceholder')}
                        value={budgetForm.amount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="budget-currency">{t('currency')}</FieldLabel>
                      <CurrencyCombobox
                        aria-label={t('currency')}
                        id="budget-currency"
                        onValueChange={(value) => onBudgetFieldChange('currencyCode', value)}
                        placeholder={t('currencyPlaceholder')}
                        value={budgetForm.currencyCode}
                      />
                    </Field>
                  </div>
                </FieldGroup>
              </div>
              <SheetFooter>
                <Button onClick={onClose} type="button" variant="outline">
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
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onExpenseSubmit}>
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
                      <MoneyInput
                        id="expense-amount"
                        onValueChange={(value) => onExpenseFieldChange('amount', value)}
                        placeholder={t('amountPlaceholder')}
                        required
                        value={expenseForm.amount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-currency">{t('currency')}</FieldLabel>
                      <CurrencyCombobox
                        aria-label={t('currency')}
                        id="expense-currency"
                        onValueChange={(value) => onExpenseFieldChange('currencyCode', value)}
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
                      onChange={(event) => onExpenseFieldChange('title', event.target.value)}
                      placeholder={t('expenseTitlePlaceholder')}
                      value={expenseForm.title}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('category')}</FieldLabel>
                    {/* Six chips rather than a Select: on a phone, categorising an
                        expense is one tap instead of three, and the tints match the
                        bars the traveller reads them back on. */}
                    <ChipGroup
                      aria-label={t('category')}
                      multiple={false}
                      onValueChange={([value]) =>
                        onExpenseFieldChange(
                          'category',
                          (value ?? 'none') as ExpenseCategory | 'none',
                        )
                      }
                      value={[expenseForm.category]}
                    >
                      {categories.map((category) => {
                        const { Icon } = resolveExpenseCategory(category);

                        return (
                          <Chip icon={<Icon aria-hidden="true" />} key={category} value={category}>
                            {t(`categories.${category}`)}
                          </Chip>
                        );
                      })}
                      <Chip value="none">{t('noCategory')}</Chip>
                    </ChipGroup>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t('date')}</FieldLabel>
                      <DatePicker
                        id="expense-date"
                        label={t('date')}
                        onChange={(value) => onExpenseFieldChange('localDate', value)}
                        value={expenseForm.localDate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-time">{t('time')}</FieldLabel>
                      <TimeInput
                        id="expense-time"
                        onValueChange={(value) => onExpenseFieldChange('localTime', value)}
                        value={expenseForm.localTime}
                      />
                      <FieldDescription>{t('timeHint')}</FieldDescription>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="expense-place">{t('linkedPlace')}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          onExpenseFieldChange('tripPlaceId', value ?? 'none')
                        }
                        value={expenseForm.tripPlaceId}
                      >
                        <SelectTrigger id="expense-place" className="w-full">
                          <SelectValue>
                            {expenseForm.tripPlaceId === 'none'
                              ? t('noLinkedPlace')
                              : resolvePlaceLabel(
                                  tripPlaces.find(
                                    (place) => place.id === expenseForm.tripPlaceId,
                                  ) ?? null,
                                  t('unnamedPlace'),
                                )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedPlace')}</SelectItem>
                          {tripPlaces.map((place) => (
                            <SelectItem key={place.id} value={place.id}>
                              {resolvePlaceLabel(place, t('unnamedPlace'))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="expense-item">{t('linkedItem')}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          onExpenseFieldChange('itineraryItemId', value ?? 'none')
                        }
                        value={expenseForm.itineraryItemId}
                      >
                        <SelectTrigger id="expense-item" className="w-full">
                          <SelectValue>
                            {expenseForm.itineraryItemId === 'none'
                              ? t('noLinkedItem')
                              : (() => {
                                  const item = itineraryItems.find(
                                    (candidate) => candidate.id === expenseForm.itineraryItemId,
                                  );
                                  return item
                                    ? resolveItemLabel(item, t('unnamedItem'))
                                    : t('unnamedItem');
                                })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedItem')}</SelectItem>
                          {itineraryItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {resolveItemLabel(item, t('unnamedItem'))}
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
                      onChange={(event) => onExpenseFieldChange('note', event.target.value)}
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
                    onClick={() => onExpenseToDeleteChange(editor.expense)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteExpense')}
                  </Button>
                ) : null}
                <Button onClick={onClose} type="button" variant="outline">
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
        onOpenChange={(open) => !open && onExpenseToDeleteChange(null)}
        open={Boolean(expenseToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                title: expenseToDelete
                  ? resolveExpenseTitle(expenseToDelete, t('untitledExpense'))
                  : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void onConfirmDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteExpense')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
