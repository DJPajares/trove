import { formatLocalTime } from './itinerary-rules.js';
import { planningDateMinute, planningMinute } from './planning-clock.js';
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
  /** Accommodation fields: which stay a day starts from and returns to. */
  tripPlaceId?: string | null;
  checkInDate?: Date | null;
  checkOutDate?: Date | null;
  accommodationDays?: ReadonlyArray<{ itineraryDayId: string }>;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const addLocalDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Booked endpoint dates/clocks are already local. Keep actual instants untouched. */
export function scoringCommitments(
  reservations: readonly ScoringReservation[],
  date: string,
): PlanScoreFixedCommitment[] {
  const minute = (d: Date | null | undefined, t: Date | null | undefined) =>
    d && t ? planningDateMinute(dateOnly(d), date, planningMinute(formatLocalTime(t)!)) : null;
  return reservations.flatMap((r): PlanScoreFixedCommitment[] => {
    const departure =
      minute(r.flightDepartureLocalDate, r.flightDepartureLocalTime) ??
      minute(r.transportDepartureLocalDate, r.transportDepartureLocalTime);
    const arrival =
      minute(r.flightArrivalLocalDate, r.flightArrivalLocalTime) ??
      minute(r.transportArrivalLocalDate, r.transportArrivalLocalTime);
    const start = departure ?? minute(r.localDate, r.localTime);
    if (start === null) return [];
    const journey = departure !== null;
    const base = {
      id: r.id,
      itemId: r.itineraryItemId ?? null,
      longDistance: journey,
      indispensable: r.indispensable,
      source: 'USER_OWNED' as const,
    };
    // A date-line crossing can have an arrival clock/date before departure.
    // Preserve both local anchors; never manufacture elapsed time or shift a stop.
    if (journey && arrival !== null && arrival < start)
      return [
        ...(start >= 0 && start < 1440
          ? [{ ...base, startMinute: start, endMinute: start, startKnown: true, endKnown: false }]
          : []),
        ...(arrival >= 0 && arrival < 1440
          ? [
              {
                ...base,
                id: `${r.id}:arrival`,
                itemId: null,
                longDistance: false,
                startMinute: arrival,
                endMinute: arrival,
                startKnown: true,
                endKnown: true,
              },
            ]
          : []),
      ];
    const knownEnd = journey && arrival !== null ? arrival : null;
    if (
      knownEnd !== null ? knownEnd <= 0 || start >= 1440 : start >= 1440 || (!journey && start < 0)
    )
      return [];
    return [
      {
        ...base,
        startMinute: Math.max(0, start),
        endMinute: knownEnd !== null ? Math.min(1440, knownEnd) : Math.max(0, start),
        startKnown: knownEnd !== null || start >= 0,
        endKnown: journey ? knownEnd !== null : true,
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
  hours: ScoringHours;
  /** On a public holiday, weekly hours are only an estimate of the day's hours. */
  holiday?: boolean;
}): PlanScoreOpeningHours {
  const { hours, date } = input;
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
          const from = planningDateMinute(p.open.date, date, p.open.hour * 60 + p.open.minute);
          const to = p.close?.date
            ? planningDateMinute(p.close.date, date, p.close.hour * 60 + p.close.minute)
            : planningDateMinute(addLocalDays(p.open.date, 1), date);
          return to > 0 && from < 1440 ? [{ startMinute: Math.max(0, from), endMinute: to }] : [];
        })
      : openingIntervalsForWeekday(periods, weekdayForLocalDate(date));
  return {
    status: 'KNOWN',
    source: input.holiday && !dated ? 'ESTIMATED' : (hours.source ?? 'CACHED_PROVIDER'),
    intervals: intervals.toSorted((a, b) => a.startMinute - b.startMinute),
  };
}
/** AI, scoring and scheduling share the same unconverted local-clock evidence. */
export function normalizeScoringItems(
  date: string,
  items: readonly PlanScoreDayItem[],
  options: {
    hours?: ReadonlyMap<string, ScoringHours>;
    commitments?: readonly PlanScoreFixedCommitment[];
    holiday?: boolean;
  } = {},
) {
  return items.map((item) => {
    const linked = options.commitments?.find((c) => c.itemId === item.id);
    const hours =
      (!item.blockType || item.blockType === 'activity') &&
      item.placeId &&
      options.hours?.has(item.placeId)
        ? scoringOpeningHours({
            date,
            hours: options.hours.get(item.placeId)!,
            holiday: options.holiday,
          })
        : item.openingHours;
    return {
      ...item,
      start: linked ? { minutes: linked.startMinute, source: linked.source } : item.start,
      duration: linked?.longDistance
        ? linked.endKnown === false
          ? null
          : { minutes: linked.endMinute - linked.startMinute, source: linked.source }
        : item.duration,
      longDistance: linked?.longDistance ?? item.longDistance,
      fixed: linked ? true : item.fixed,
      startWindow: linked ? null : item.startWindow,
      openingHours: hours,
    };
  });
}
