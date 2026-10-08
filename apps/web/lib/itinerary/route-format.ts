/**
 * A travel time as people say it: "12 min", "1 hr 5 min", "2 hr". Shared by
 * the day's legs, its route summary and the planner's day facts, so a leg and
 * the total it adds to are never written two ways.
 */
export function formatTravelDuration(seconds: number, locale: string) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const minuteFormatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  });
  if (minutes < 60) return minuteFormatter.format(minutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourValue = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
  }).format(hours);
  return remainingMinutes ? `${hourValue} ${minuteFormatter.format(remainingMinutes)}` : hourValue;
}

/** Time planned at stops, rounded to the quarter hour beyond the first hour: "45 min", "5 hr 15 min". */
export function formatPlannedDuration(minutes: number, locale: string) {
  const rounded = minutes > 60 ? Math.round(minutes / 15) * 15 : minutes;
  return formatTravelDuration(rounded * 60, locale);
}
