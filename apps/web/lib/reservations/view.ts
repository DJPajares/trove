import type { Reservation, ReservationType } from '@/lib/reservations/api';
import { calendarDayDistance } from '@/lib/trips/lifecycle';

type TripDay = { date: string; id: string };

/** Types whose booking is a journey with a departure and an arrival of its own. */
export const JOURNEY_TYPES: readonly ReservationType[] = [
  'bus',
  'ferry',
  'other',
  'rental_car',
  'train',
];

export function isJourneyType(type: ReservationType | null | undefined) {
  return type ? JOURNEY_TYPES.includes(type) : false;
}

/**
 * When a reservation happens, read from wherever its type keeps it: a flight's
 * or a train's departure, a stay's check-in, otherwise the booking's own date.
 * A reservation saved before those details existed still has its plain date,
 * so that is always the fallback - nothing with a date is ever lost to "No date".
 */
export type ReservationWhen = {
  date: string | null;
  endDate: string | null;
  endTime: string | null;
  time: string | null;
};

export function reservationWhen(reservation: Reservation): ReservationWhen {
  const plain = { date: reservation.localDate, time: reservation.localTime };
  if (reservation.type === 'flight' && reservation.flight) {
    const { arrival, departure } = reservation.flight;
    return {
      date: departure?.localDate ?? plain.date,
      endDate: arrival?.localDate ?? null,
      endTime: arrival?.localTime ?? null,
      time: departure?.localDate ? (departure.localTime ?? null) : plain.time,
    };
  }
  if (isJourneyType(reservation.type) && reservation.transport) {
    const { arrival, departure } = reservation.transport;
    return {
      date: departure?.localDate ?? plain.date,
      endDate: arrival?.localDate ?? null,
      endTime: arrival?.localTime ?? null,
      time: departure?.localDate ? (departure.localTime ?? null) : plain.time,
    };
  }
  if (reservation.type === 'accommodation') {
    return {
      date: reservation.checkInDate ?? plain.date,
      endDate: reservation.checkOutDate,
      endTime: null,
      time: !reservation.checkInDate || reservation.checkInDate === plain.date ? plain.time : null,
    };
  }
  return { ...plain, endDate: null, endTime: null };
}

/** Whole days between a journey's departure and arrival, for "+1". Zero when unknown. */
export function arrivalDayOffset(when: ReservationWhen) {
  return when.date && when.endDate ? Math.max(0, calendarDayDistance(when.date, when.endDate)) : 0;
}

/** Nights in a stay, or null when either date is missing. */
export function stayNights(reservation: Reservation) {
  if (!reservation.checkInDate || !reservation.checkOutDate) return null;
  return Math.max(0, calendarDayDistance(reservation.checkInDate, reservation.checkOutDate));
}

function compareWhen(left: Reservation, right: Reservation) {
  const a = reservationWhen(left);
  const b = reservationWhen(right);
  return (
    (a.date ?? '').localeCompare(b.date ?? '') ||
    // Untimed bookings sit after the timed ones on the same day.
    (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.title.localeCompare(right.title)
  );
}

export type ReservationGroup =
  | { items: Reservation[]; key: 'before'; kind: 'before' }
  | { date: string; dayNumber: number; items: Reservation[]; key: string; kind: 'day' }
  | { items: Reservation[]; key: 'after'; kind: 'after' }
  | { items: Reservation[]; key: 'undated'; kind: 'undated' };

/**
 * Reservations as the trip reads them: anything booked before it starts, then
 * each trip day in order, then anything after, and finally whatever has no
 * date yet. Empty groups are left out, so a short list stays short.
 */
export function groupReservationsByDay(
  reservations: readonly Reservation[],
  days: readonly TripDay[],
): ReservationGroup[] {
  const ordered = days.toSorted((left, right) => left.date.localeCompare(right.date));
  const first = ordered[0]?.date ?? null;
  const last = ordered.at(-1)?.date ?? null;
  const byDate = new Map(ordered.map((day, index) => [day.date, index + 1]));
  const before: Reservation[] = [];
  const after: Reservation[] = [];
  const undated: Reservation[] = [];
  const onDay = new Map<string, Reservation[]>();

  for (const reservation of reservations.toSorted(compareWhen)) {
    const { date } = reservationWhen(reservation);
    if (!date) undated.push(reservation);
    else if (byDate.has(date)) onDay.set(date, [...(onDay.get(date) ?? []), reservation]);
    else if (first && date < first) before.push(reservation);
    else if (last && date > last) after.push(reservation);
    // A dated booking on a trip with no days yet still needs a home.
    else before.push(reservation);
  }

  return [
    ...(before.length ? [{ items: before, key: 'before' as const, kind: 'before' as const }] : []),
    ...ordered
      .filter((day) => onDay.has(day.date))
      .map((day) => ({
        date: day.date,
        dayNumber: byDate.get(day.date) ?? 0,
        items: onDay.get(day.date) ?? [],
        key: day.id,
        kind: 'day' as const,
      })),
    ...(after.length ? [{ items: after, key: 'after' as const, kind: 'after' as const }] : []),
    ...(undated.length
      ? [{ items: undated, key: 'undated' as const, kind: 'undated' as const }]
      : []),
  ];
}

/**
 * The next booking from now, in the trip's own calendar. A booking today with
 * no time counts as still ahead - it is today's to deal with.
 */
export function nextReservation(
  reservations: readonly Reservation[],
  today: string,
  nowTime: string,
): Reservation | null {
  return (
    reservations.toSorted(compareWhen).find((reservation) => {
      const { date, time } = reservationWhen(reservation);
      if (!date) return false;
      if (date > today) return true;
      return date === today && (time === null || time >= nowTime);
    }) ?? null
  );
}

/**
 * How many of the trip's nights a booked stay covers. A trip of N days has
 * N - 1 nights; a night is covered when some stay checks in on or before it
 * and checks out after it. Null when the trip has no nights to cover.
 */
export function stayNightsCovered(
  reservations: readonly Reservation[],
  days: readonly TripDay[],
): { covered: number; total: number } | null {
  const nights = days
    .map((day) => day.date)
    .toSorted()
    .slice(0, -1);
  if (!nights.length) return null;
  const stays = reservations.filter(
    (reservation) =>
      reservation.type === 'accommodation' && reservation.checkInDate && reservation.checkOutDate,
  );
  const covered = nights.filter((night) =>
    stays.some(
      (stay) => (stay.checkInDate as string) <= night && night < (stay.checkOutDate as string),
    ),
  ).length;
  return { covered, total: nights.length };
}

/**
 * The trip days a stay applies to: check-in day through check-out day. The
 * server keeps check-in to the evening and check-out to the morning (PRD 19.3),
 * so both ends belong. With only a check-in, that one day.
 */
export function stayDayIds(checkIn: string, checkOut: string, days: readonly TripDay[]): string[] {
  if (!checkIn) return [];
  const end = checkOut && checkOut >= checkIn ? checkOut : checkIn;
  return days.filter((day) => day.date >= checkIn && day.date <= end).map((day) => day.id);
}
