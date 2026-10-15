import type { StayRange } from '@trove/types';

type Day = { date: string; start: string | null; end: string | null };
/** Compress AI's resolved endpoints without filling unknowns or creating bookings. */
export function groupAppliedStays(days: readonly Day[]) {
  const places = new Set(
    days.flatMap((d) => [d.start, d.end].filter((id): id is string => id !== null)),
  );
  const defaultTripPlaceId = places.size === 1 ? [...places][0]! : null;
  const ranges: StayRange[] = [];
  const overrides = new Map<
    string,
    {
      stayStartMode: 'INHERIT' | 'PLACE' | 'NONE';
      stayEndMode: 'INHERIT' | 'PLACE' | 'NONE';
      dailyBaseTripPlaceId: string | null;
      dailyBaseDepartureTripPlaceId: string | null;
    }
  >();
  for (const day of days) {
    if (!defaultTripPlaceId && day.start && day.start === day.end) {
      const previous = ranges.at(-1);
      const nextDate = previous ? new Date(`${previous.endDate}T00:00:00.000Z`) : null;
      nextDate?.setUTCDate(nextDate.getUTCDate() + 1);
      if (
        previous &&
        previous.tripPlaceId === day.start &&
        nextDate?.toISOString().slice(0, 10) === day.date
      )
        previous.endDate = day.date;
      else ranges.push({ tripPlaceId: day.start, startDate: day.date, endDate: day.date });
    }
    const automatic = defaultTripPlaceId ?? (day.start && day.start === day.end ? day.start : null);
    overrides.set(day.date, {
      stayStartMode: !day.start ? 'NONE' : day.start === automatic ? 'INHERIT' : 'PLACE',
      stayEndMode: !day.end ? 'NONE' : day.end === automatic ? 'INHERIT' : 'PLACE',
      dailyBaseTripPlaceId: day.start === automatic ? null : day.start,
      dailyBaseDepartureTripPlaceId: day.end === automatic ? null : day.end,
    });
  }
  return { defaultTripPlaceId, ranges, overrides };
}
