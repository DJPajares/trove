import type { TaskContext, TasksResponse } from '@/lib/tasks/api';

export type TaskScope = 'day' | 'item' | 'trip';

export const UNSCHEDULED_TASK_DAY = 'unscheduled';

export function taskScope(context: TaskContext): TaskScope {
  return context.kind;
}

export function taskContextDay(context: TaskContext, contexts: TasksResponse['contexts']): string {
  if (context.kind === 'day') return context.itineraryDayId;
  if (context.kind === 'item') {
    return (
      contexts.items.find((item) => item.id === context.itineraryItemId)?.itineraryDayId ??
      UNSCHEDULED_TASK_DAY
    );
  }
  return contexts.days[0]?.id ?? UNSCHEDULED_TASK_DAY;
}

export function firstTaskItemForDay(contexts: TasksResponse['contexts'], itineraryDayId: string) {
  return contexts.items.find(
    (item) => (item.itineraryDayId ?? UNSCHEDULED_TASK_DAY) === itineraryDayId,
  );
}

export function taskContextForScope(input: {
  contexts: TasksResponse['contexts'];
  dayId: string;
  itemDayId: string;
  itemId: string;
  scope: TaskScope;
}): TaskContext {
  if (input.scope === 'day') {
    const day = input.contexts.days.find((candidate) => candidate.id === input.dayId);
    return day ? { itineraryDayId: day.id, kind: 'day' } : { kind: 'trip' };
  }
  if (input.scope === 'item') {
    const item = input.contexts.items.find(
      (candidate) =>
        candidate.id === input.itemId &&
        (candidate.itineraryDayId ?? UNSCHEDULED_TASK_DAY) === input.itemDayId,
    );
    return item ? { itineraryItemId: item.id, kind: 'item' } : { kind: 'trip' };
  }
  return { kind: 'trip' };
}
