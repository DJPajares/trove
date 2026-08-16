import type { PlanScoreInterval } from './plan-score-factors.js';

/**
 * The single definition of what Morning, Afternoon and Evening mean in minutes
 * from local midnight. Trip Mode already used these boundaries to decide what is
 * happening now; Plan Score reads them to score a coarse timing as a window
 * rather than ignoring it (PRD section 29.2, coarse daypart evidence).
 *
 * Half-open: a window covers `startMinute` up to but not including `endMinute`.
 */
export const DAY_PART_WINDOWS = {
  AFTERNOON: { endMinute: 1020, startMinute: 720 },
  EVENING: { endMinute: 1440, startMinute: 1020 },
  MORNING: { endMinute: 720, startMinute: 0 },
} as const satisfies Record<string, PlanScoreInterval>;

/** Ordered earliest to latest, so a position in the day can be compared. */
export const DAY_PART_ORDER = ['MORNING', 'AFTERNOON', 'EVENING'] as const;

export type ScorableDayPart = (typeof DAY_PART_ORDER)[number];

/**
 * The window a daypart constrains an item to, or `null` when it constrains
 * nothing.
 *
 * `ANYTIME` deliberately yields no window. A whole-day range cannot be violated,
 * so treating it as evidence would lower confidence while carrying no
 * information — PRD section 29.1 asks for evidence a rubric actually needs.
 */
export function dayPartWindow(dayPart: string | null | undefined): PlanScoreInterval | null {
  if (!dayPart) return null;

  return DAY_PART_WINDOWS[dayPart as ScorableDayPart] ?? null;
}

/** Index of the daypart containing `hour`, matching `DAY_PART_ORDER`. */
export function dayPartIndexForHour(hour: number): number {
  const minute = hour * 60;
  const index = DAY_PART_ORDER.findIndex((part) => minute < DAY_PART_WINDOWS[part].endMinute);

  return index === -1 ? DAY_PART_ORDER.length - 1 : index;
}
