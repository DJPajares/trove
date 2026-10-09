import type { Task } from '@/lib/tasks/api';
import type { Trip } from '@/lib/trips/api';
import { daysUntilTripStart, resolveReadinessPrompt } from '@/lib/trips/lifecycle';
import type { TripWeatherDay } from '@/lib/weather/api';

/** At most this many steps. A list longer than a glance is a checklist, and Trove has one. */
export const HOME_NEXT_STEP_LIMIT = 3;

/** How close departure has to be before an offline copy is worth raising. */
export const OFFLINE_NUDGE_DAYS = 3;

export type HomeNextStep =
  | { kind: 'offline' }
  | { kind: 'openDays'; open: number; total: number }
  | { kind: 'readiness'; prompt: 'nudge' | 'suggest' }
  | { count: number; kind: 'tasks'; next: Task }
  | { day: TripWeatherDay; kind: 'weather' };

export type HomeNextStepInput = {
  now?: Date;
  /**
   * Whether this device holds a complete offline copy. Null while it is still
   * being read, or when it cannot be - neither is a reason to nag.
   */
  offlineReady: boolean | null;
  /** The trip's tasks, or null when they have not loaded. */
  tasks: Task[] | null;
  trip: Trip;
  /** The forecast for the trip's first day, once it is within the provider's reach. */
  weather: TripWeatherDay | null;
};

/** Undone tasks, the ones with a due date first, soonest first. */
function openTasks(tasks: readonly Task[]) {
  return tasks
    .filter((task) => !task.completed)
    .toSorted((left, right) => {
      if (left.dueDate && right.dueDate) return left.dueDate.localeCompare(right.dueDate);
      if (left.dueDate || right.dueDate) return left.dueDate ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    });
}

/**
 * What a trip still being planned asks of the traveller next, most
 * consequential first, and only what genuinely applies.
 *
 * Every step is a description of the trip as it stands, never a score or a
 * streak: the readiness question only ever asks (PRD 6.2), open days are the
 * itinerary coverage the trip already reports (PRD 9.2), and an offline copy is
 * raised only in the last few days, when lacking one starts to matter more
 * than anything left to plan (PRD 28.4). The first day's forecast closes the
 * list - worth knowing, never something to do. Nothing applies, nothing shows.
 */
export function selectNextSteps({
  now = new Date(),
  offlineReady,
  tasks,
  trip,
  weather,
}: HomeNextStepInput): HomeNextStep[] {
  if (trip.lifecycle !== 'planning') return [];

  const steps: HomeNextStep[] = [];
  const days = daysUntilTripStart(trip, now);

  const readiness = resolveReadinessPrompt(trip, now);
  if (readiness) steps.push({ kind: 'readiness', prompt: readiness });

  // Days from departure, a missing offline copy outranks everything still to plan.
  if (offlineReady === false && days <= OFFLINE_NUDGE_DAYS) steps.push({ kind: 'offline' });

  const coverage = trip.itineraryCoverage;
  if (coverage && coverage.plannedDays < coverage.totalDays) {
    steps.push({
      kind: 'openDays',
      open: coverage.totalDays - coverage.plannedDays,
      total: coverage.totalDays,
    });
  }

  const open = tasks ? openTasks(tasks) : [];
  if (open[0]) steps.push({ count: open.length, kind: 'tasks', next: open[0] });

  if (weather) steps.push({ day: weather, kind: 'weather' });

  return steps.slice(0, HOME_NEXT_STEP_LIMIT);
}
