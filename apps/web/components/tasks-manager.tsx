'use client';

import { CircleAlert, ClipboardCheck, Layers, List, Pencil, Plus, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageState } from '@/components/page-state';
import { TaskEditorSheet, type TaskEditorSubmission } from '@/components/task-editor-sheet';
import { TripSectionHeader } from '@/components/trip-section-header';
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
import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/tabs';
import {
  createTask,
  deleteTask,
  fetchTasks,
  type Task,
  type TaskContext,
  type TasksResponse,
  updateTask,
} from '@/lib/tasks/api';
import { groupTasksByContext } from '@/lib/tasks/grouping';

type EditorState =
  { mode: 'closed'; task: null } | { mode: 'create'; task: null } | { mode: 'edit'; task: Task };

type TasksView = 'grouped' | 'list';

const VIEW_STORAGE_KEY = 'trove.tasks-view';

function readStoredView(): TasksView | null {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'grouped' || stored === 'list' ? stored : null;
  } catch {
    return null;
  }
}

function storeView(view: TasksView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // A browser that refuses storage still gets the view it asked for; only the
    // remembering is lost.
  }
}

/** One labelled run of rows inside a grouped day: its own tasks, or one stop's. */
function TaskSubGroup({
  label,
  renderTask,
  tasks,
}: Readonly<{ label: string; renderTask: (task: Task) => ReactNode; tasks: readonly Task[] }>) {
  if (!tasks.length) return null;
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <p className="mb-1 px-3 text-xs font-semibold text-foreground">{label}</p>
      <ItemGroup aria-label={label} variant="list">
        {tasks.map(renderTask)}
      </ItemGroup>
    </div>
  );
}

export function TasksManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tasks');
  const locale = useLocale();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', task: null });
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [changingTaskId, setChangingTaskId] = useState<string | null>(null);
  const [view, setView] = useState<TasksView>('list');

  // Read after mount: the server has no way to know which view this browser
  // last chose, and guessing during render would hydrate the wrong one.
  useEffect(() => {
    const stored = readStoredView();
    if (stored) setView(stored);
  }, []);

  function changeView(next: TasksView) {
    setView(next);
    storeView(next);
  }

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
  const openTasks = data?.tasks.filter((task) => !task.completed) ?? [];
  const completedTasks = data?.tasks.filter((task) => task.completed) ?? [];
  // Completed work keeps its own section below, so the groups stay a picture of
  // what is still to do.
  const groups = data ? groupTasksByContext(openTasks, data.contexts) : null;

  function formatDate(value: string) {
    return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
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
    setEditor({ mode: 'create', task: null });
  }

  function openEdit(task: Task) {
    setEditor({ mode: 'edit', task });
  }

  function closeEditor() {
    setEditor({ mode: 'closed', task: null });
  }

  async function saveEditor(input: TaskEditorSubmission, task: Task | null) {
    if (task) return (await updateTask(tripId, task.id, input)).task;
    return (await createTask(tripId, input)).task;
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

  function renderTaskRow(task: Task, showContext: boolean) {
    const completed = task.completed;
    // Calendar-date comparison, matching how a due date is already treated
    // everywhere else in this file (a date the traveller picked, not a zoned
    // instant) — not a new timezone concept.
    const isOverdue =
      !completed && task.dueDate !== null && task.dueDate < new Date().toISOString().slice(0, 10);
    const dueDateText = task.dueDate
      ? task.dueLocalTime
        ? t('dueDateTime', { date: formatDate(task.dueDate), time: task.dueLocalTime })
        : t('dueDate', { date: formatDate(task.dueDate) })
      : null;
    const dueDateLabel = dueDateText ? (
      isOverdue ? (
        <Badge size="sm" variant="warning">
          {dueDateText}
        </Badge>
      ) : (
        <span className="font-medium text-foreground">{dueDateText}</span>
      )
    ) : null;

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
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Inside a group the heading already says where the task sits;
                  repeating it in every row is noise. */}
              {showContext ? <span>{contextLabel(task.context)}</span> : null}
              {dueDateLabel}
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

  const renderTask = (task: Task) => renderTaskRow(task, true);
  const renderGroupedTask = (task: Task) => renderTaskRow(task, false);

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

  return (
    <section className="space-y-7">
      <TripSectionHeader
        actions={
          <>
            <Button
              nativeButton={false}
              render={<Link href="/tools/task-templates" />}
              variant="outline"
            >
              <Wrench aria-hidden="true" data-icon="inline-start" />
              {t('templates')}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addTask')}
            </Button>
          </>
        }
        currentSection="tasks"
        description={t('description')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {openTasks.length ? (
        <EditorialSection
          actions={
            <Tabs onValueChange={(value) => changeView(value as TasksView)} value={view}>
              <TabsList aria-label={t('viewNavigation')}>
                <TabsTab className="gap-2" value="list">
                  <List aria-hidden="true" data-icon="inline-start" />
                  {t('viewList')}
                </TabsTab>
                <TabsTab className="gap-2" value="grouped">
                  <Layers aria-hidden="true" data-icon="inline-start" />
                  {t('viewGrouped')}
                </TabsTab>
                <TabsIndicator />
              </TabsList>
            </Tabs>
          }
          description={t('openDescription', { count: openTasks.length })}
          headerLayout="inline"
          title={t('open')}
        >
          {view === 'list' || !groups ? (
            <ItemGroup aria-label={t('open')} variant="list">
              {openTasks.map(renderTask)}
            </ItemGroup>
          ) : (
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {groups.trip.length ? (
                <section aria-label={t('groupTrip')} className="py-4">
                  <h3 className="px-3 text-sm font-semibold text-foreground">{t('groupTrip')}</h3>
                  <ItemGroup aria-label={t('groupTrip')} className="mt-1" variant="list">
                    {groups.trip.map(renderGroupedTask)}
                  </ItemGroup>
                </section>
              ) : null}
              {groups.days.map(({ day, dayTasks, items }) => (
                <section aria-label={formatDate(day.date)} className="py-4" key={day.id}>
                  <h3 className="px-3 text-sm font-semibold text-foreground">
                    {formatDate(day.date)}
                  </h3>
                  <div className="mt-1 divide-y divide-border-subtle">
                    <TaskSubGroup
                      label={t('groupDayTasks')}
                      renderTask={renderGroupedTask}
                      tasks={dayTasks}
                    />
                    {items.map((item) => (
                      <TaskSubGroup
                        key={item.id}
                        label={item.label}
                        renderTask={renderGroupedTask}
                        tasks={item.tasks}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {groups.unscheduled.length ? (
                <section aria-label={t('groupUnscheduled')} className="py-4">
                  <h3 className="px-3 text-sm font-semibold text-foreground">
                    {t('groupUnscheduled')}
                  </h3>
                  <div className="mt-1 divide-y divide-border-subtle">
                    {groups.unscheduled.map((item) => (
                      <TaskSubGroup
                        key={item.id}
                        label={item.label}
                        renderTask={renderGroupedTask}
                        tasks={item.tasks}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </EditorialSection>
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
        <EditorialSection
          description={t('completedDescription', { count: completedTasks.length })}
          title={t('completed')}
        >
          <ItemGroup aria-label={t('completed')} variant="list">
            {completedTasks.map(renderTask)}
          </ItemGroup>
        </EditorialSection>
      ) : null}

      {editor.mode !== 'closed' ? (
        <TaskEditorSheet
          contexts={data.contexts}
          onDeleteRequest={setTaskToDelete}
          onOpenChange={(open) => !open && closeEditor()}
          onSaved={refresh}
          onSubmit={saveEditor}
          open
          task={editor.task}
        />
      ) : null}

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
