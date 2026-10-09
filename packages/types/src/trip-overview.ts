/** A single trip's contextual hub. Stored data only; never provider acquisition. */
export type TripOverviewData = {
  generatedAt: string;
  refreshAt: string;
  clockTimeZone: string;
  destinations: { id: string; name: string | null }[];
  lifecycle: 'planning' | 'active' | 'completed';
  day: {
    id: string;
    date: string;
    number: number;
    name: string | null;
    stopCount: number;
    state: 'empty' | 'finished' | 'planned';
    current: TripOverviewStop | null;
    next: TripOverviewStop | null;
  } | null;
  tasks: { openCount: number; next: { id: string; label: string; dueDate: string | null } | null };
  memories: {
    photos: { id: string; url: string; contentType: string }[];
    note: string | null;
  };
  pinnedInfo: { id: string; label: string; value: string }[];
};

export type TripOverviewStop = {
  id: string;
  label: string | null;
  localStartTime: string | null;
  startInstant: string | null;
  kind: 'current' | 'relevant' | 'next' | 'planned';
};

/** An open day is the useful entry while planning; travel follows the device clock. */
export function selectTripOverviewDay<T extends { date: string; stopCount: number }>(
  days: readonly T[],
  lifecycle: TripOverviewData['lifecycle'],
  today: string,
): T | null {
  if (lifecycle === 'completed') return null;
  if (lifecycle === 'active') return days.find((day) => day.date === today) ?? null;
  return days.find((day) => day.stopCount === 0) ?? days[0] ?? null;
}

/** Contextual tasks during travel; overdue dated tasks remain actionable. */
export function isTripOverviewTaskRelevant(
  task: { dayId: string | null; itemId: string | null; dueDate: string | null },
  lifecycle: TripOverviewData['lifecycle'],
  today: string,
  dayId: string | null,
  itemIds: readonly string[],
) {
  if (lifecycle === 'completed') return false;
  if (lifecycle === 'planning') return true;
  return Boolean(
    (task.dayId && task.dayId === dayId) ||
    (task.itemId && itemIds.includes(task.itemId)) ||
    (task.dueDate && task.dueDate <= today),
  );
}
