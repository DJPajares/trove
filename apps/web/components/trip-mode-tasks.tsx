'use client';

import { CheckCircle2, ChevronDown, CircleAlert, ListChecks, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { TaskEditorSheet, type TaskEditorSubmission } from '@/components/task-editor-sheet';
import { useOfflineDataRefreshKey } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  createTask,
  fetchTasks,
  type Task,
  type TaskContext,
  type TasksResponse,
  updateTask,
} from '@/lib/tasks/api';
import { replaceTripModeTask, sortTripModeTasks, withTaskCompletion } from '@/lib/tasks/trip-mode';
import { cn } from '@/lib/utils';

type TaskLoadStatus = 'error' | 'loading' | 'ready';

type TripModeTasksContextValue = {
  busyTaskIds: ReadonlySet<string>;
  data: TasksResponse | null;
  error: string | null;
  openCreate: (context: TaskContext) => void;
  retry: () => void;
  status: TaskLoadStatus;
  toggleTask: (task: Task) => Promise<void>;
};

const TripModeTasksContext = createContext<TripModeTasksContextValue>({
  busyTaskIds: new Set(),
  data: null,
  error: null,
  openCreate: () => undefined,
  retry: () => undefined,
  status: 'loading',
  toggleTask: async () => undefined,
});

export function useTripModeTasks() {
  return useContext(TripModeTasksContext);
}

export function TripModeTasksProvider({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const t = useTranslations('tripMode.tasks');
  const offlineDataRefreshKey = useOfflineDataRefreshKey();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [status, setStatus] = useState<TaskLoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(() => new Set());
  const [editorContext, setEditorContext] = useState<TaskContext | null>(null);

  useEffect(() => {
    let active = true;
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    void fetchTasks(tripId)
      .then((response) => {
        if (!active) return;
        setData(response);
        setStatus('ready');
        setError(null);
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [offlineDataRefreshKey, reloadKey, tripId]);

  const openCreate = useCallback((context: TaskContext) => setEditorContext(context), []);

  const saveTask = useCallback(
    async (input: TaskEditorSubmission) => {
      const { task } = await createTask(tripId, input);
      setData((current) =>
        current
          ? {
              ...current,
              tasks: sortTripModeTasks([
                task,
                ...current.tasks.filter((item) => item.id !== task.id),
              ]),
            }
          : current,
      );
      return task;
    },
    [tripId],
  );

  const toggleTask = useCallback(
    async (task: Task) => {
      const completed = !task.completed;
      const optimistic = withTaskCompletion(task, completed);
      setBusyTaskIds((current) => new Set(current).add(task.id));
      setError(null);
      setData((current) =>
        current
          ? {
              ...current,
              tasks: replaceTripModeTask(current.tasks, optimistic),
            }
          : current,
      );
      try {
        const { task: saved } = await updateTask(tripId, task.id, { completed });
        setData((current) =>
          current
            ? {
                ...current,
                tasks: replaceTripModeTask(current.tasks, saved),
              }
            : current,
        );
      } catch {
        setData((current) =>
          current
            ? {
                ...current,
                tasks: replaceTripModeTask(current.tasks, task),
              }
            : current,
        );
        setError(t('actionError'));
      } finally {
        setBusyTaskIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      }
    },
    [t, tripId],
  );

  const retry = useCallback(() => setReloadKey((current) => current + 1), []);

  const value = useMemo<TripModeTasksContextValue>(
    () => ({ busyTaskIds, data, error, openCreate, retry, status, toggleTask }),
    [busyTaskIds, data, error, openCreate, retry, status, toggleTask],
  );

  return (
    <TripModeTasksContext.Provider value={value}>
      {children}
      {editorContext && data ? (
        <TaskEditorSheet
          contexts={data.contexts}
          initialContext={editorContext}
          onOpenChange={(open) => !open && setEditorContext(null)}
          onSaved={() => setError(null)}
          onSubmit={saveTask}
          open
        />
      ) : null}
    </TripModeTasksContext.Provider>
  );
}

export function TripModeTasksNotice() {
  const t = useTranslations('tripMode.tasks');
  const { error, retry, status } = useTripModeTasks();
  if (!error && status !== 'error') return null;
  return (
    <Alert role="alert" variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{error ?? t('loadError')}</AlertDescription>
      <Button onClick={retry} size="xs" variant="ghost">
        {t('retry')}
      </Button>
    </Alert>
  );
}

function TaskRows({ tasks }: Readonly<{ tasks: readonly Task[] }>) {
  const t = useTranslations('tripMode.tasks');
  const locale = useLocale();
  const { busyTaskIds, toggleTask } = useTripModeTasks();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
    [locale],
  );
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
  return (
    <ItemGroup variant="list">
      {tasks.map((task) => (
        <Item className="min-h-14 flex-nowrap px-2 py-2.5" key={task.id} size="sm">
          <ItemMedia className="size-8" variant="icon">
            <input
              aria-label={t(task.completed ? 'reopen' : 'complete', { label: task.label })}
              checked={task.completed}
              className="size-5 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-wait"
              disabled={busyTaskIds.has(task.id)}
              onChange={() => void toggleTask(task)}
              type="checkbox"
            />
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0.5">
            <ItemTitle className={cn(task.completed && 'text-muted-foreground line-through')}>
              {task.label}
            </ItemTitle>
            {task.note || task.dueDate ? (
              <ItemDescription className="line-clamp-2">
                {task.dueDate ? (
                  <span className="mr-2 font-medium text-foreground">
                    {task.dueLocalTime
                      ? t('dueDateTime', {
                          date: formatDate(task.dueDate),
                          time: task.dueLocalTime,
                        })
                      : t('dueDate', { date: formatDate(task.dueDate) })}
                  </span>
                ) : null}
                {task.note}
              </ItemDescription>
            ) : null}
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

export function TripModeTaskList({
  className,
  emptyText,
  tasks,
}: Readonly<{ className?: string; emptyText?: string; tasks: readonly Task[] }>) {
  const t = useTranslations('tripMode.tasks');
  const sorted = sortTripModeTasks(tasks);
  const openTasks = sorted.filter((task) => !task.completed);
  const completedTasks = sorted.filter((task) => task.completed);
  return (
    <div className={cn('space-y-2', className)}>
      {openTasks.length ? (
        <TaskRows tasks={openTasks} />
      ) : (
        <p className="py-2 text-sm leading-6 text-muted-foreground">
          {emptyText ?? t('nothingOpen')}
        </p>
      )}
      {completedTasks.length ? (
        <Collapsible>
          <CollapsibleTrigger className="group">
            <CheckCircle2 aria-hidden="true" />
            {t('completedCount', { count: completedTasks.length })}
            <ChevronDown
              aria-hidden="true"
              className="transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-2">
              <TaskRows tasks={completedTasks} />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </div>
  );
}

export function TripModeTaskDisclosure({
  addContext,
  className,
  tasks,
  title,
}: Readonly<{
  addContext?: TaskContext;
  className?: string;
  tasks: readonly Task[];
  title: string;
}>) {
  const t = useTranslations('tripMode.tasks');
  const { openCreate } = useTripModeTasks();
  const openCount = tasks.filter((task) => !task.completed).length;
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="group w-full justify-between gap-3 py-2 text-left">
        <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
          <ListChecks aria-hidden="true" className="text-brand" />
          <span className="truncate">{title}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {t('openCount', { count: openCount })}
          <ChevronDown
            aria-hidden="true"
            className="transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-3 pb-3">
          <TripModeTaskList tasks={tasks} />
          {addContext ? (
            <Button onClick={() => openCreate(addContext)} size="xs" variant="ghost">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('add')}
            </Button>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function ManageTasksLink({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.tasks');
  return (
    <Button
      nativeButton={false}
      render={<Link href={`/trips/${tripId}/tasks`} />}
      size="sm"
      variant="ghost"
    >
      {t('manage')}
    </Button>
  );
}
