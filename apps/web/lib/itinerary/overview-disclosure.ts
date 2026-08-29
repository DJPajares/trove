export function initiallyExpandedOverviewDayIds(
  days: readonly { id: string; items: readonly unknown[] }[],
): Set<string> {
  return new Set(days.map((day) => day.id));
}

export function allOverviewDaysExpanded(
  expandedDayIds: ReadonlySet<string>,
  dayIds: readonly string[],
): boolean {
  return dayIds.every((dayId) => expandedDayIds.has(dayId));
}

export function toggleOverviewDay(
  expandedDayIds: ReadonlySet<string>,
  dayId: string,
  expanded: boolean,
): Set<string> {
  const next = new Set(expandedDayIds);

  if (expanded) next.add(dayId);
  else next.delete(dayId);

  return next;
}

export function setAllOverviewDaysExpanded(
  expandedDayIds: ReadonlySet<string>,
  dayIds: readonly string[],
  expanded: boolean,
): Set<string> {
  const next = new Set(expandedDayIds);

  for (const dayId of dayIds) {
    if (expanded) next.add(dayId);
    else next.delete(dayId);
  }

  return next;
}
