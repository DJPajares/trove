import {
  floatingLocalTimeToInstant,
  formatLocalTime,
  formatInstantInTimeZone,
} from './itinerary-rules.js';
import { openingIntervalsForWeekday, weekdayForLocalDate } from './place-opening-hours.js';
import type { PlaceOpeningPeriod } from './places.js';
import type {
  PlanScoreDayItem,
  PlanScoreFixedCommitment,
  PlanScoreInterval,
  PlanScoreOpeningHours,
} from './plan-score-factors.js';

export type ScoringReservation = {
  indispensable?: boolean;
  transportPickupLocation?: string | null;
  transportDropoffLocation?: string | null;
  id: string;
  itineraryItemId?: string | null;
  type?: string | null;
  localDate?: Date | null;
  localTime?: Date | null;
  timeZone?: string | null;
  flightDepartureInstant?: Date | null;
  flightArrivalInstant?: Date | null;
  flightDepartureLocalDate?: Date | null;
  flightDepartureLocalTime?: Date | null;
  flightDepartureTimeZone?: string | null;
  flightArrivalLocalDate?: Date | null;
  flightArrivalLocalTime?: Date | null;
  flightArrivalTimeZone?: string | null;
  transportDepartureInstant?: Date | null;
  transportArrivalInstant?: Date | null;
  transportDepartureLocalDate?: Date | null;
  transportDepartureLocalTime?: Date | null;
  transportDepartureTimeZone?: string | null;
  transportArrivalLocalDate?: Date | null;
  transportArrivalLocalTime?: Date | null;
  transportArrivalTimeZone?: string | null;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const addLocalDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
function instant(
  date: Date | null | undefined,
  time: Date | null | undefined,
  zone: string | null | undefined,
): Date | null {
  if (!date || !time || !zone) return null;
  try {
    return floatingLocalTimeToInstant(dateOnly(date), formatLocalTime(time)!, zone);
  } catch {
    return null;
  }
}
export function dayOrigin(date: string, zone: string): number {
  return floatingLocalTimeToInstant(date, '00:00', zone).getTime();
}
export function elapsedLocalMinute(date: string, zone: string, minute: number, origin: number) {
  const days = Math.floor(minute / 1440),
    within = ((minute % 1440) + 1440) % 1440;
  const time = `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(Math.floor(within % 60)).padStart(2, '0')}`;
  return (
    (floatingLocalTimeToInstant(addLocalDays(date, days), time, zone).getTime() - origin) / 60000 +
    (within % 1)
  );
}
/** Structured journeys are clipped to each day's real 23/24/25-hour interval. */
export function scoringCommitments(
  reservations: readonly ScoringReservation[],
  date: string,
  zone: string,
): PlanScoreFixedCommitment[] {
  const origin = dayOrigin(date, zone),
    end = dayOrigin(addLocalDays(date, 1), zone);
  return reservations.flatMap((r) => {
    const departure =
      r.flightDepartureInstant ??
      r.transportDepartureInstant ??
      instant(r.flightDepartureLocalDate, r.flightDepartureLocalTime, r.flightDepartureTimeZone) ??
      instant(
        r.transportDepartureLocalDate,
        r.transportDepartureLocalTime,
        r.transportDepartureTimeZone,
      );
    const arrival =
      r.flightArrivalInstant ??
      r.transportArrivalInstant ??
      instant(r.flightArrivalLocalDate, r.flightArrivalLocalTime, r.flightArrivalTimeZone) ??
      instant(r.transportArrivalLocalDate, r.transportArrivalLocalTime, r.transportArrivalTimeZone);
    const standalone = instant(r.localDate, r.localTime, r.timeZone);
    const start = departure ?? standalone;
    if (!start || !Number.isFinite(start.getTime())) return [];
    const journey = departure !== null;
    const knownEnd = journey && arrival && arrival.getTime() >= start.getTime() ? arrival : null;
    if (
      knownEnd
        ? knownEnd.getTime() <= origin || start.getTime() >= end
        : start.getTime() >= end || (!journey && start.getTime() < origin)
    )
      return [];
    return [
      {
        id: r.id,
        itemId: r.itineraryItemId ?? null,
        startMinute: Math.max(0, (start.getTime() - origin) / 60000),
        endMinute: knownEnd
          ? Math.min((end - origin) / 60000, (knownEnd.getTime() - origin) / 60000)
          : Math.max(0, (start.getTime() - origin) / 60000),
        // A known journey occupies the clipped arrival-day interval from midnight.
        // An unknown arrival only carries uncertainty forward, not a proven interval.
        startKnown: knownEnd !== null || start.getTime() >= origin,
        endKnown: journey ? knownEnd !== null : true,
        longDistance: journey,
        indispensable: r.indispensable,
        source: 'USER_OWNED' as const,
      },
    ];
  });
}
export type ScoringHours = {
  periods: PlaceOpeningPeriod[];
  utcOffsetMinutes: number | null;
  source?: 'CACHED_PROVIDER' | 'FRESH_PROVIDER';
  timeZone?: string | null;
  fetchedAt?: string;
  currentPeriods?: PlaceOpeningPeriod[];
  validFrom?: string | null;
  validThrough?: string | null;
};
export function scoringOpeningHours(input: {
  date: string;
  zone: string;
  origin: number;
  hours: ScoringHours;
}): PlanScoreOpeningHours {
  const { hours, date, zone, origin } = input;
  // A coordinate-derived IANA zone avoids treating a provider's current UTC offset
  // as a timezone on a future date or across DST.
  const ownZone = hours.timeZone ?? zone;
  if (!hours.timeZone && hours.utcOffsetMinutes !== null && hours.fetchedAt) {
    const local = formatInstantInTimeZone(new Date(hours.fetchedAt), zone);
    const offset =
      (Date.parse(`${local.date}T${local.time}:00Z`) - Date.parse(hours.fetchedAt)) / 60000;
    if (Math.abs(offset - hours.utcOffsetMinutes) > 1) return { status: 'UNKNOWN' };
  }
  const dated =
    hours.currentPeriods &&
    hours.validFrom &&
    hours.validThrough &&
    date >= hours.validFrom &&
    date <= hours.validThrough;
  const periods = dated ? hours.currentPeriods! : hours.periods;
  if (!periods.length) return { status: 'UNKNOWN' };
  const intervals: PlanScoreInterval[] =
    dated && periods.some((p) => p.open.date)
      ? periods.flatMap((p) => {
          if (!p.open.date) return [];
          const from = elapsedLocalMinute(
            p.open.date,
            ownZone,
            p.open.hour * 60 + p.open.minute,
            origin,
          );
          const to = p.close?.date
            ? elapsedLocalMinute(p.close.date, ownZone, p.close.hour * 60 + p.close.minute, origin)
            : elapsedLocalMinute(addLocalDays(p.open.date, 1), ownZone, 0, origin);
          return to > 0 && from < elapsedLocalMinute(date, ownZone, 1440, origin)
            ? [{ startMinute: Math.max(0, from), endMinute: to }]
            : [];
        })
      : openingIntervalsForWeekday(periods, weekdayForLocalDate(date)).flatMap((interval) => {
          try {
            return [
              {
                startMinute: elapsedLocalMinute(date, ownZone, interval.startMinute, origin),
                endMinute: elapsedLocalMinute(date, ownZone, interval.endMinute, origin),
              },
            ];
          } catch {
            return [];
          }
        });
  return {
    status: 'KNOWN',
    source: hours.source ?? 'CACHED_PROVIDER',
    intervals: intervals.toSorted((a, b) => a.startMinute - b.startMinute),
  };
}
/** Both AI and stored trips pass civil-minute items through this same conversion. */
export function normalizeScoringItems(
  date: string,
  zone: string,
  items: readonly PlanScoreDayItem[],
  options: {
    zones?: ReadonlyMap<string, string>;
    instants?: ReadonlyMap<string, Date>;
    hours?: ReadonlyMap<string, ScoringHours>;
    commitments?: readonly PlanScoreFixedCommitment[];
  } = {},
) {
  const origin = dayOrigin(date, zone);
  return items.map((item) => {
    const ownZone = options.zones?.get(item.id) ?? zone;
    const linked = options.commitments?.find((c) => c.itemId === item.id);
    let start = item.start;
    let startWindow = item.startWindow;
    let hours = item.openingHours;
    try {
      if (start)
        start = {
          ...start,
          minutes: options.instants?.has(item.id)
            ? (options.instants.get(item.id)!.getTime() - origin) / 60000
            : elapsedLocalMinute(date, ownZone, start.minutes, origin),
        };
      if (startWindow)
        startWindow = {
          ...startWindow,
          earliestMinute: elapsedLocalMinute(date, ownZone, startWindow.earliestMinute, origin),
          latestMinute: elapsedLocalMinute(date, ownZone, startWindow.latestMinute, origin),
        };
      if (item.placeId && options.hours?.has(item.placeId))
        hours = scoringOpeningHours({
          date,
          zone: ownZone,
          origin,
          hours: options.hours.get(item.placeId)!,
        });
      else if (hours.status === 'KNOWN')
        hours = {
          ...hours,
          intervals: hours.intervals.map((h) => ({
            startMinute: elapsedLocalMinute(date, ownZone, h.startMinute, origin),
            endMinute: elapsedLocalMinute(date, ownZone, h.endMinute, origin),
          })),
        };
    } catch {
      start = null;
      startWindow = null;
      hours = { status: 'UNKNOWN' };
    }
    return {
      ...item,
      start: linked ? { minutes: linked.startMinute, source: linked.source } : start,
      duration: linked?.longDistance
        ? linked.endKnown === false
          ? null
          : { minutes: linked.endMinute - linked.startMinute, source: linked.source }
        : item.duration,
      longDistance: linked?.longDistance ?? item.longDistance,
      fixed: linked ? true : item.fixed,
      startWindow: linked ? null : startWindow,
      openingHours: hours,
    };
  });
}
