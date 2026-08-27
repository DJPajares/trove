'use client';

import { CircleAlert, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { DatePicker } from '@/components/date-picker';
import { TimeInput } from '@/components/time-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  firstTaskItemForDay,
  taskContextDay,
  taskContextForScope,
  taskScope,
  UNSCHEDULED_TASK_DAY,
  type TaskScope,
} from '@/lib/tasks/context';
import type { Task, TaskContext, TaskInput, TasksResponse } from '@/lib/tasks/api';

export type TaskEditorSubmission = Required<Pick<TaskInput, 'context' | 'label'>> & TaskInput;

type TaskForm = {
  dayId: string;
  dueDate: string;
  dueLocalTime: string;
  itemDayId: string;
  itemId: string;
  label: string;
  note: string;
  scope: TaskScope;
};

type TaskEditorSheetProps = {
  contexts: TasksResponse['contexts'];
  initialContext?: TaskContext;
  onDeleteRequest?: (task: Task) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (task: Task) => void | Promise<void>;
  onSubmit: (input: TaskEditorSubmission, task: Task | null) => Promise<Task>;
  open: boolean;
  task?: Task | null;
};

function createForm(
  contexts: TasksResponse['contexts'],
  task: Task | null,
  initialContext: TaskContext | undefined,
): TaskForm {
  const context = task?.context ?? initialContext ?? { kind: 'trip' as const };
  const itemDayId = taskContextDay(context, contexts);
  const item =
    context.kind === 'item'
      ? contexts.items.find((candidate) => candidate.id === context.itineraryItemId)
      : (firstTaskItemForDay(contexts, itemDayId) ?? contexts.items[0]);
  return {
    dayId: context.kind === 'day' ? context.itineraryDayId : (contexts.days[0]?.id ?? ''),
    dueDate: task?.dueDate ?? '',
    dueLocalTime: task?.dueLocalTime ?? '',
    itemDayId: item?.itineraryDayId ?? UNSCHEDULED_TASK_DAY,
    itemId: item?.id ?? '',
    label: task?.label ?? '',
    note: task?.note ?? '',
    scope: taskScope(context),
  };
}

export function TaskEditorSheet({
  contexts,
  initialContext,
  onDeleteRequest,
  onOpenChange,
  onSaved,
  onSubmit,
  open,
  task = null,
}: Readonly<TaskEditorSheetProps>) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [form, setForm] = useState<TaskForm>(() => createForm(contexts, task, initialContext));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(createForm(contexts, task, initialContext));
    setFormError(null);
  }, [contexts, initialContext, open, task]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
        year: 'numeric',
      }),
    [locale],
  );
  const itemDayOptions = useMemo(() => {
    const ids = new Set(contexts.items.map((item) => item.itineraryDayId ?? UNSCHEDULED_TASK_DAY));
    return [
      ...contexts.days.filter((day) => ids.has(day.id)).map((day) => day.id),
      ...(ids.has(UNSCHEDULED_TASK_DAY) ? [UNSCHEDULED_TASK_DAY] : []),
    ];
  }, [contexts]);
  const visibleItems = contexts.items.filter(
    (item) => (item.itineraryDayId ?? UNSCHEDULED_TASK_DAY) === form.itemDayId,
  );
  const selectedItem = visibleItems.find((item) => item.id === form.itemId);
  const idPrefix = task ? `task-${task.id}` : 'task-create';

  function formatDate(value: string) {
    return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
  }

  function dayLabel(dayId: string) {
    if (dayId === UNSCHEDULED_TASK_DAY) return t('contextUnscheduled');
    const day = contexts.days.find((candidate) => candidate.id === dayId);
    return day ? formatDate(day.date) : t('contextDayUnavailable');
  }

  function itemLabel(item: TasksResponse['contexts']['items'][number]) {
    return item.localStartTime
      ? t('placeWithTime', { label: item.label, time: item.localStartTime })
      : item.label;
  }

  function scopeLabel(scope: TaskScope) {
    if (scope === 'day') return t('scopeDay');
    if (scope === 'item') return t('scopeItem');
    return t('scopeTrip');
  }

  function updateForm<Key extends keyof TaskForm>(key: Key, value: TaskForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function changeScope(scope: TaskScope) {
    setForm((current) => {
      if (scope !== 'item') return { ...current, scope };
      const nextDayId = itemDayOptions.includes(current.itemDayId)
        ? current.itemDayId
        : (itemDayOptions[0] ?? '');
      const currentItem = contexts.items.find(
        (item) =>
          item.id === current.itemId && (item.itineraryDayId ?? UNSCHEDULED_TASK_DAY) === nextDayId,
      );
      return {
        ...current,
        itemDayId: nextDayId,
        itemId: currentItem?.id ?? firstTaskItemForDay(contexts, nextDayId)?.id ?? '',
        scope,
      };
    });
    setFormError(null);
  }

  function changeItemDay(itemDayId: string) {
    setForm((current) => ({
      ...current,
      itemDayId,
      itemId: firstTaskItemForDay(contexts, itemDayId)?.id ?? '',
    }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = form.label.trim();
    if (!label) {
      setFormError(t('labelRequired'));
      return;
    }
    if (!form.dueDate && form.dueLocalTime) {
      setFormError(t('dueTimeRequiresDate'));
      return;
    }
    const context = taskContextForScope({
      contexts,
      dayId: form.dayId,
      itemDayId: form.itemDayId,
      itemId: form.itemId,
      scope: form.scope,
    });
    if (context.kind !== form.scope) {
      setFormError(t('contextRequired'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const saved = await onSubmit(
        {
          context,
          dueDate: form.dueDate || null,
          dueLocalTime: form.dueLocalTime || null,
          label,
          note: form.note.trim() || null,
        },
        task,
      );
      await onSaved(saved);
      onOpenChange(false);
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{task ? t('editTitle') : t('createTitle')}</SheetTitle>
          <SheetDescription>
            {task ? t('editDescription') : t('createDescription')}
          </SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <FieldGroup>
              {formError ? (
                <Alert role="alert" variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-label`}>{t('label')}</FieldLabel>
                <Input
                  id={`${idPrefix}-label`}
                  maxLength={200}
                  onChange={(event) => updateForm('label', event.target.value)}
                  placeholder={t('labelPlaceholder')}
                  required
                  value={form.label}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-scope`}>{t('context')}</FieldLabel>
                <Select
                  onValueChange={(value) => changeScope((value ?? 'trip') as TaskScope)}
                  value={form.scope}
                >
                  <SelectTrigger className="w-full" id={`${idPrefix}-scope`}>
                    <SelectValue>{scopeLabel(form.scope)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="trip">{t('scopeTrip')}</SelectItem>
                    <SelectItem value="day">{t('scopeDay')}</SelectItem>
                    <SelectItem value="item">{t('scopeItem')}</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>{t('contextHint')}</FieldDescription>
              </Field>
              {form.scope === 'day' ? (
                <Field>
                  <FieldLabel htmlFor={`${idPrefix}-day`}>{t('specificDay')}</FieldLabel>
                  <Select
                    onValueChange={(value) => updateForm('dayId', value ?? '')}
                    value={form.dayId}
                  >
                    <SelectTrigger className="w-full" id={`${idPrefix}-day`}>
                      <SelectValue>{dayLabel(form.dayId)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {contexts.days.map((day) => (
                        <SelectItem key={day.id} value={day.id}>
                          {formatDate(day.date)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              {form.scope === 'item' ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${idPrefix}-item-day`}>{t('placeDay')}</FieldLabel>
                    <Select
                      onValueChange={(value) => changeItemDay(value ?? '')}
                      value={form.itemDayId}
                    >
                      <SelectTrigger className="w-full" id={`${idPrefix}-item-day`}>
                        <SelectValue>{dayLabel(form.itemDayId)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {itemDayOptions.map((dayId) => (
                          <SelectItem key={dayId} value={dayId}>
                            {dayLabel(dayId)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${idPrefix}-item`}>{t('specificPlace')}</FieldLabel>
                    <Select
                      onValueChange={(value) => updateForm('itemId', value ?? '')}
                      value={form.itemId}
                    >
                      <SelectTrigger className="w-full" id={`${idPrefix}-item`}>
                        <SelectValue>
                          {selectedItem ? itemLabel(selectedItem) : t('contextItemUnavailable')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {visibleItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {itemLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t('specificPlaceHint')}</FieldDescription>
                  </Field>
                </>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t('dueDateLabel')}</FieldLabel>
                  <DatePicker
                    id={`${idPrefix}-due-date`}
                    label={t('dueDateLabel')}
                    onChange={(value) => {
                      updateForm('dueDate', value);
                      if (!value) updateForm('dueLocalTime', '');
                    }}
                    value={form.dueDate}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${idPrefix}-due-time`}>{t('dueTimeLabel')}</FieldLabel>
                  <TimeInput
                    disabled={!form.dueDate}
                    id={`${idPrefix}-due-time`}
                    onValueChange={(value) => updateForm('dueLocalTime', value)}
                    value={form.dueLocalTime}
                  />
                </Field>
              </div>
              <FieldDescription>{t('dueTimeHint')}</FieldDescription>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-note`}>{t('note')}</FieldLabel>
                <Textarea
                  id={`${idPrefix}-note`}
                  maxLength={5000}
                  onChange={(event) => updateForm('note', event.target.value)}
                  placeholder={t('notePlaceholder')}
                  value={form.note}
                />
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
            {task && onDeleteRequest ? (
              <Button onClick={() => onDeleteRequest(task)} type="button" variant="destructive">
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                {t('deleteTask')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                disabled={saving}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={saving} type="submit">
                {saving ? t('saving') : task ? t('save') : t('addTask')}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
