/** A plan uses destination-local calendar dates and clock minutes, never instants.
 * UTC is only a timezone-neutral carrier for calendar arithmetic and formatting.
 */
export const PLANNING_DAY_MINUTES = 1440;
export function planningMinute(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
}
export function planningTime(minute: number) {
  const within =
    ((Math.floor(minute) % PLANNING_DAY_MINUTES) + PLANNING_DAY_MINUTES) % PLANNING_DAY_MINUTES;
  return `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
}
export function planningDateMinute(date: string, relativeTo: string, minute = 0) {
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${relativeTo}T00:00:00Z`)) / 60000 + minute;
}
export function planningLocalDateTime(date: string, minute: number) {
  const localDate = new Date(
    Date.parse(`${date}T00:00:00Z`) + Math.floor(minute / PLANNING_DAY_MINUTES) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  return `${localDate}T${planningTime(minute)}`;
}

export function planningDuration(
  start: string | null,
  end: string | null,
  duration: number | null,
) {
  if (!end || !start) return duration;
  const minutes = planningMinute(end) - planningMinute(start);
  return minutes > 0 ? minutes : null;
}
