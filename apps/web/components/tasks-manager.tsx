'use client';

import { ArrowLeft, CircleAlert, ClipboardCheck, Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { DatePicker } from '@/components/date-picker';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
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
  createTask,
  deleteTask,
  fetchTasks,
  type Task,
  type TaskContext,
  type TasksResponse,
  updateTask,
} from '@/lib/tasks/api';

type EditorState =
  { mode: 'closed'; task: null } | { mode: 'create'; task: null } | { mode: 'edit'; task: Task };
type TaskForm = {
  context: string;
  dueDate: string;
  dueLocalTime: string;
  label: string;
  note: string;
};

function contextValue(context: TaskContext) {
  if (context.kind === 'day') return `day:${context.itineraryDayId}`;
  if (context.kind === 'item') return `item:${context.itineraryItemId}`;
  return 'trip';
}

function contextFromValue(value: string): TaskContext {
  if (value.startsWith('day:')) return { itineraryDayId: value.slice(4), kind: 'day' };
  if (value.startsWith('item:')) return { itineraryItemId: value.slice(5), kind: 'item' };
  return { kind: 'trip' };
}

function createForm(task: Task | null): TaskForm {
  return {
    context: task ? contextValue(task.context) : 'trip',
    dueDate: task?.dueDate ?? '',
    dueLocalTime: task?.dueLocalTime ?? '',
    label: task?.label ?? '',
    note: task?.note ?? '',
  };
}

export function TasksManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', task: null });
  const [form, setForm] = useState<TaskForm>(() => createForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [changingTaskId, setChangingTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchTasks(tripId));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const longDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
        year: 'numeric',
      }),
    [locale],
  );
  const openTasks = data?.tasks.filter((task) => !task.completed) ?? [];
  const completedTasks = data?.tasks.filter((task) => task.completed) ?? [];

  function formatDate(value: string, long = false) {
    return (long ? longDateFormatter : dateFormatter).format(new Date(`${value}T00:00:00.000Z`));
  }

  function contextLabel(context: TaskContext) {
    if (!data || context.kind === 'trip') return t('contextTrip');
    if (context.kind === 'day') {
      const day = data.contexts.days.find((value) => value.id === context.itineraryDayId);
      return day ? t('contextDay', { date: formatDate(day.date) }) : t('contextDayUnavailable');
    }
    const item = data.contexts.items.find((value) => value.id === context.itineraryItemId);
    return item?.label ?? t('contextItemUnavailable');
  }

  function openCreate() {
    setForm(createForm(null));
    setFormError(null);
    setEditor({ mode: 'create', task: null });
  }

  function openEdit(task: Task) {
    setForm(createForm(task));
    setFormError(null);
    setEditor({ mode: 'edit', task });
  }

  function closeEditor() {
    setEditor({ mode: 'closed', task: null });
    setFormError(null);
  }

  function updateForm<Key extends keyof TaskForm>(key: Key, value: TaskForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
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
    setSaving(true);
    setFormError(null);
    const input = {
      context: contextFromValue(form.context),
      dueDate: form.dueDate || null,
      dueLocalTime: form.dueLocalTime || null,
      label,
      note: form.note.trim() || null,
    };
    try {
      if (editor.mode === 'create') {
        await createTask(tripId, input);
      } else if (editor.mode === 'edit') {
        await updateTask(tripId, editor.task.id, input);
      }
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCompletion(task: Task) {
    setChangingTaskId(task.id);
    setError(null);
    try {
      await updateTask(tripId, task.id, { completed: !task.completed });
      await refresh();
    } catch {
      setError(t('completionError'));
    } finally {
      setChangingTaskId(null);
    }
  }

  async function handleDelete() {
    if (!taskToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(tripId, taskToDelete.id);
      setTaskToDelete(null);
      closeEditor();
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  function renderTask(task: Task) {
    const completed = task.completed;
    return (
      <Item className="min-h-16 flex-nowrap px-3 py-3" key={task.id} variant="default">
        <ItemMedia className="size-9" variant="icon">
          <input
            aria-label={t(completed ? 'markOpen' : 'markComplete', { label: task.label })}
            checked={completed}
            className="size-5 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-wait"
            disabled={changingTaskId === task.id}
            onChange={() => void handleCompletion(task)}
            type="checkbox"
          />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle className={completed ? 'text-muted-foreground line-through' : undefined}>
            {task.label}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            <span className="flex flex-wrap gap-x-2 gap-y-1">
              <span>{contextLabel(task.context)}</span>
              {task.dueDate ? (
                <span>
                  {task.dueLocalTime
                    ? t('dueDateTime', { date: formatDate(task.dueDate), time: task.dueLocalTime })
                    : t('dueDate', { date: formatDate(task.dueDate) })}
                </span>
              ) : null}
            </span>
            {task.note ? <span className="mt-1 block line-clamp-2">{task.note}</span> : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            aria-label={t('editTask', { label: task.label })}
            onClick={() => openEdit(task)}
            size="icon-sm"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
          </Button>
        </ItemActions>
      </Item>
    );
  }

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

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader
        actions={
          <>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/itinerary`} />}
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('backToItinerary')}
            </Button>
            <Button nativeButton={false} render={<Link href="/tools" />} variant="outline">
              <Wrench aria-hidden="true" data-icon="inline-start" />
              {t('templates')}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addTask')}
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

      {openTasks.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('open')}</h2>
              <p className="text-sm text-muted-foreground">{t('openDescription')}</p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">{openTasks.length}</span>
          </div>
          <ItemGroup aria-label={t('open')} variant="list">
            {openTasks.map(renderTask)}
          </ItemGroup>
        </section>
      ) : (
        <PageState
          actions={
            <Button onClick={openCreate} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstTask')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<ClipboardCheck aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      )}

      {completedTasks.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('completed')}</h2>
              <p className="text-sm text-muted-foreground">{t('completedDescription')}</p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {completedTasks.length}
            </span>
          </div>
          <ItemGroup aria-label={t('completed')} variant="list">
            {completedTasks.map(renderTask)}
          </ItemGroup>
        </section>
      ) : null}

      <Sheet onOpenChange={(open) => !open && closeEditor()} open={editor.mode !== 'closed'}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{editor.mode === 'edit' ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>
              {editor.mode === 'edit' ? t('editDescription') : t('createDescription')}
            </SheetDescription>
          </SheetHeader>
          {editor.mode !== 'closed' ? (
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
                    <FieldLabel htmlFor="task-label">{t('label')}</FieldLabel>
                    <Input
                      id="task-label"
                      maxLength={200}
                      onChange={(event) => updateForm('label', event.target.value)}
                      placeholder={t('labelPlaceholder')}
                      required
                      value={form.label}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="task-context">{t('context')}</FieldLabel>
                    <Select
                      onValueChange={(value) => updateForm('context', value ?? 'trip')}
                      value={form.context}
                    >
                      <SelectTrigger className="w-full" id="task-context">
                        <SelectValue>{contextLabel(contextFromValue(form.context))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="trip">{t('contextTrip')}</SelectItem>
                        {data.contexts.days.map((day) => (
                          <SelectItem key={day.id} value={`day:${day.id}`}>
                            {t('contextDay', { date: formatDate(day.date, true) })}
                          </SelectItem>
                        ))}
                        {data.contexts.items.map((item) => (
                          <SelectItem key={item.id} value={`item:${item.id}`}>
                            {t('contextItem', { label: item.label })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t('contextHint')}</FieldDescription>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t('dueDateLabel')}</FieldLabel>
                      <DatePicker
                        id="task-due-date"
                        label={t('dueDateLabel')}
                        onChange={(value) => {
                          updateForm('dueDate', value);
                          if (!value) updateForm('dueLocalTime', '');
                        }}
                        value={form.dueDate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="task-due-time">{t('dueTimeLabel')}</FieldLabel>
                      <TimeInput
                        disabled={!form.dueDate}
                        id="task-due-time"
                        onValueChange={(value) => updateForm('dueLocalTime', value)}
                        value={form.dueLocalTime}
                      />
                    </Field>
                  </div>
                  <FieldDescription>{t('dueTimeHint')}</FieldDescription>
                  <Field>
                    <FieldLabel htmlFor="task-note">{t('note')}</FieldLabel>
                    <Textarea
                      id="task-note"
                      maxLength={5000}
                      onChange={(event) => updateForm('note', event.target.value)}
                      placeholder={t('notePlaceholder')}
                      value={form.note}
                    />
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
                {editor.mode === 'edit' ? (
                  <Button
                    onClick={() => setTaskToDelete(editor.task)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteTask')}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button disabled={saving} onClick={closeEditor} type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                  <Button disabled={saving} type="submit">
                    {saving ? t('saving') : editor.mode === 'edit' ? t('save') : t('addTask')}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        onOpenChange={(open) => !open && setTaskToDelete(null)}
        open={Boolean(taskToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { label: taskToDelete?.label ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteTask')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
