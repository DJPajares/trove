import { shiftStayDate, stayRangeForEndpoint, type StayRange } from '@trove/types';

type Day = { date: string; start: string | null; end: string | null };
/** Compress AI's resolved endpoints without filling unknowns or creating bookings. */
export function groupAppliedStays(days: readonly Day[]) {
  const places = new Set(
    days.flatMap((d) => [d.start, d.end].filter((id): id is string => id !== null)),
  );
  const defaultTripPlaceId = places.size === 1 ? [...places][0]! : null;
  const ranges: StayRange[] = [];
  const orderedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = orderedDays.at(0)?.date;
  const lastDate = orderedDays.at(-1)?.date;
  const overrides = new Map<
    string,
    {
      stayStartMode: 'INHERIT' | 'PLACE' | 'NONE';
      stayEndMode: 'INHERIT' | 'PLACE' | 'NONE';
      dailyBaseTripPlaceId: string | null;
      dailyBaseDepartureTripPlaceId: string | null;
    }
  >();
  for (const day of orderedDays) {
    // Keep any final-day evening endpoint as a day exception, within the trip.
    if (!defaultTripPlaceId && day.end && day.date !== lastDate) {
      const previous = ranges.at(-1);
      if (previous && previous.tripPlaceId === day.end && previous.endDate === day.date)
        previous.endDate = shiftStayDate(day.date, 1);
      else
        ranges.push({
          tripPlaceId: day.end,
          startDate: day.date,
          endDate: shiftStayDate(day.date, 1),
        });
    }
  }
  for (const day of days) {
    const automaticStart =
      (day.date === firstDate ? null : defaultTripPlaceId) ??
      stayRangeForEndpoint(ranges, day.date, 'start')?.tripPlaceId ??
      null;
    const automaticEnd =
      defaultTripPlaceId ?? stayRangeForEndpoint(ranges, day.date, 'end')?.tripPlaceId ?? null;
    overrides.set(day.date, {
      stayStartMode: !day.start ? 'NONE' : day.start === automaticStart ? 'INHERIT' : 'PLACE',
      stayEndMode: !day.end ? 'NONE' : day.end === automaticEnd ? 'INHERIT' : 'PLACE',
      dailyBaseTripPlaceId: day.start === automaticStart ? null : day.start,
      dailyBaseDepartureTripPlaceId: day.end === automaticEnd ? null : day.end,
    });
  }
  return { defaultTripPlaceId, ranges, overrides };
}
