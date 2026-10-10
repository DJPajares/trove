import type { ItineraryDay, ItineraryDayTimeSuggestion, ItineraryItem } from '@/lib/itinerary/api';

/** Looks up a string under the `itinerary` namespace. */
export type ItineraryTranslator = (key: string) => string;

/**
 * The one sentence that explains a proposed time. Shared by the single-stop
 * button and the whole-day preview so they always say the same thing.
 */
export function describeSuggestedTime(
  suggestion: ItineraryDayTimeSuggestion,
  t: ItineraryTranslator,
): string {
  if (suggestion.status === 'no_feasible_time')
    return suggestion.blockedBy[0]
      ? t(`connectedTiming.issue.${suggestion.blockedBy[0]}`)
      : t('suggestedTime.none');
  // Section 29.4: say it cannot, without itemising what was missing.
  if (suggestion.status === 'insufficient_evidence')
    return ['DURATION_UNKNOWN', 'TRAVEL_UNKNOWN', 'CONTEXT_UNKNOWN'].includes(
      suggestion.missing[0] ?? '',
    )
      ? t(`connectedTiming.issue.${suggestion.missing[0]}`)
      : t('suggestedTime.unavailable');

  // The last constraint that actually moved the clock explains the answer best.
  // The day start is only a floor, and the following-item check validates the
  // time rather than setting it.
  const moved = suggestion.reasons.filter(
    (reason) => reason.code !== 'DAY_START' && reason.code !== 'BEFORE_FIXED_ITEM',
  );
  const reason = moved.at(-1);
  const caveat =
    ['TIGHT_TRANSITION', 'OPENING_HOURS_UNKNOWN', 'TRAVEL_ESTIMATED', 'DURATION_ESTIMATED'].find(
      (code) => suggestion.caveats.includes(code),
    ) ?? suggestion.caveats[0];

  return [
    reason ? t(`suggestedTime.reason.${reason.code}`) : t('suggestedTime.applied'),
    caveat ? t(`suggestedTime.caveat.${caveat}`) : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Stops on the day that have no exact time: the ones a suggestion is for. */
export function untimedItems(day: Pick<ItineraryDay, 'items'>): ItineraryItem[] {
  return day.items.filter((item) => !item.localStartTime);
}

export type DayTimeRow = {
  itemId: string;
  name: string;
  suggestion: ItineraryDayTimeSuggestion;
};

/** Only a proposal that found a time can be applied. */
export function isApplicable(row: DayTimeRow) {
  return row.suggestion.status === 'ok' && Boolean(row.suggestion.localTime);
}

/** Everything that found a time starts selected; the traveller opts out, not in. */
export function defaultSelection(rows: readonly DayTimeRow[]): Set<string> {
  return new Set(rows.filter(isApplicable).map((row) => row.itemId));
}

/**
 * The updates to save, earliest first, so the day settles into its order in one
 * pass. Ties keep the day's own order.
 */
export function orderedUpdates(rows: readonly DayTimeRow[], selected: ReadonlySet<string>) {
  return rows
    .flatMap((row, index) =>
      selected.has(row.itemId) && isApplicable(row) && row.suggestion.localTime
        ? [{ index, itemId: row.itemId, localTime: row.suggestion.localTime }]
        : [],
    )
    .toSorted((a, b) => a.localTime.localeCompare(b.localTime) || a.index - b.index)
    .map(({ itemId, localTime }) => ({ itemId, localTime }));
}

/** `HH:MM` as the traveller reads the clock, in their own 12/24 hour choice. */
export function formatSuggestedClock(localTime: string, locale: string, hour12: boolean) {
  const [hour = 0, minute = 0] = localTime.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12,
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

export function formatSuggestedDuration(
  minutes: number,
  t: (key: string, values: Record<string, number>) => string,
) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return t(
    hours
      ? remainder
        ? 'connectedTiming.hoursMinutes'
        : 'connectedTiming.hours'
      : 'connectedTiming.minutes',
    { hours, minutes: remainder || (hours ? 0 : minutes) },
  );
}
