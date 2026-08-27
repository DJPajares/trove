import type { Task, TaskContext } from '@/lib/tasks/api';

export type NowTaskGroup = {
  itemId: string;
  kind: 'here' | 'next';
  tasks: Task[];
};

export function sortTripModeTasks(tasks: readonly Task[]) {
  return tasks.toSorted((left, right) => {
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    const leftDue = `${left.dueDate ?? '9999-12-31'}T${left.dueLocalTime ?? '23:59'}`;
    const rightDue = `${right.dueDate ?? '9999-12-31'}T${right.dueLocalTime ?? '23:59'}`;
    return leftDue.localeCompare(rightDue) || left.createdAt.localeCompare(right.createdAt);
  });
}

export function withTaskCompletion(task: Task, completed: boolean, now = new Date().toISOString()) {
  return {
    ...task,
    completed,
    completedAt: completed ? now : null,
    updatedAt: now,
  };
}

export function replaceTripModeTask(tasks: readonly Task[], replacement: Task) {
  return sortTripModeTasks(tasks.map((task) => (task.id === replacement.id ? replacement : task)));
}

export function tasksForItem(tasks: readonly Task[], itemId: string | null | undefined) {
  if (!itemId) return [];
  return sortTripModeTasks(
    tasks.filter((task) => task.context.kind === 'item' && task.context.itineraryItemId === itemId),
  );
}

export function nowTaskGroups(
  tasks: readonly Task[],
  currentItemId: string | null | undefined,
  nextItemId: string | null | undefined,
) {
  const groups: NowTaskGroup[] = [];
  if (currentItemId) {
    const currentTasks = tasksForItem(tasks, currentItemId);
    if (currentTasks.length)
      groups.push({ itemId: currentItemId, kind: 'here', tasks: currentTasks });
  }
  if (nextItemId && nextItemId !== currentItemId) {
    const nextTasks = tasksForItem(tasks, nextItemId);
    if (nextTasks.length) groups.push({ itemId: nextItemId, kind: 'next', tasks: nextTasks });
  }
  return groups;
}

export function todayTaskRollup(input: {
  date: string;
  dayId: string;
  itemIds: readonly string[];
  tasks: readonly Task[];
}) {
  const itemIds = new Set(input.itemIds);
  const seen = new Set<string>();
  return sortTripModeTasks(
    input.tasks.filter((task) => {
      const relevant =
        (task.context.kind === 'trip' && task.dueDate === input.date) ||
        (task.context.kind === 'day' && task.context.itineraryDayId === input.dayId) ||
        (task.context.kind === 'item' && itemIds.has(task.context.itineraryItemId));
      if (!relevant || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    }),
  );
}

export function tripTasks(tasks: readonly Task[]) {
  return sortTripModeTasks(tasks.filter((task) => task.context.kind === 'trip'));
}

export function contextualTasks(tasks: readonly Task[]) {
  return sortTripModeTasks(tasks.filter((task) => task.context.kind !== 'trip'));
}

export function defaultTripModeTaskContext(input: {
  currentItemId?: string | null;
  dayId?: string | null;
  nextItemId?: string | null;
}): TaskContext {
  const itemId = input.currentItemId ?? input.nextItemId;
  if (itemId) return { itineraryItemId: itemId, kind: 'item' };
  if (input.dayId) return { itineraryDayId: input.dayId, kind: 'day' };
  return { kind: 'trip' };
}
