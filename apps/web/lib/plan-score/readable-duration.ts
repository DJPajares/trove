/** Plan Score values that are lengths of time in minutes. */
export const MINUTE_VALUE_KEYS = [
  'minutes',
  'plannedMinutes',
  'bestMinutes',
  'bufferMinutes',
  'overlapMinutes',
] as const;

/**
 * A length of time in the unit a person pictures it in: minutes under an hour,
 * then hours to the nearest half - "about 5.5 hours" rather than 333 minutes.
 */
export function readableDuration(minutes: number): { count: number; unit: 'hours' | 'minutes' } {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return { count: whole, unit: 'minutes' };
  return { count: Math.round(whole / 30) / 2, unit: 'hours' };
}
