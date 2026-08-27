import type { Task, TasksResponse } from '@/lib/tasks/api';
import { sortTripModeTasks, tripTasks } from '@/lib/tasks/trip-mode';

export type ItemTaskGroup = {
  id: string;
  label: string;
  tasks: Task[];
};

export type DayTaskGroup = {
  day: TasksResponse['contexts']['days'][number];
  dayTasks: Task[];
  items: ItemTaskGroup[];
};

export type TaskGrouping = {
  days: DayTaskGroup[];
  trip: Task[];
  unscheduled: ItemTaskGroup[];
};

/**
 * The trip's tasks arranged the way a traveller reads them: what belongs to the
 * whole trip, then each day with its own tasks and the tasks of its stops. A day
 * or a stop with nothing to do is not a group, so empty ones are left out
 * entirely rather than rendered as blanks.
 */
export function groupTasksByContext(
  tasks: readonly Task[],
  contexts: TasksResponse['contexts'],
): TaskGrouping {
  const itemTasks = (itemId: string) =>
    sortTripModeTasks(
      tasks.filter(
        (task) => task.context.kind === 'item' && task.context.itineraryItemId === itemId,
      ),
    );
  const itemGroups = (itineraryDayId: string | null) =>
    contexts.items
      .filter((item) => item.itineraryDayId === itineraryDayId)
      .map((item) => ({ id: item.id, label: item.label, tasks: itemTasks(item.id) }))
      .filter((item) => item.tasks.length);

  return {
    days: contexts.days
      .map((day) => ({
        day,
        dayTasks: sortTripModeTasks(
          tasks.filter(
            (task) => task.context.kind === 'day' && task.context.itineraryDayId === day.id,
          ),
        ),
        items: itemGroups(day.id),
      }))
      .filter((group) => group.dayTasks.length || group.items.length),
    trip: tripTasks(tasks),
    // A stop the traveller has not placed on a day still carries its tasks, and
    // they belong somewhere the eye can reach: the bucket named for that state.
    unscheduled: itemGroups(null),
  };
}
