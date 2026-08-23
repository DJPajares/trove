/**
 * Trip dates are plain `YYYY-MM-DD` calendar dates, not instants: a trip that
 * starts on the 5th starts on the 5th wherever the traveller reads it. Parsing
 * them at UTC midnight and formatting in UTC is what keeps that true - a device
 * behind UTC would otherwise render the day before.
 */
function parseTripDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatTripDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(parseTripDate(value));
}

/**
 * A trip's span as one string, collapsing whatever the two ends share.
 *
 * `formatRange` drops the repeated month and year itself, so a trip inside one
 * month reads as "5 - 21 Sep 2026" rather than repeating both.
 */
export function formatTripDateRange(startDate: string, endDate: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).formatRange(parseTripDate(startDate), parseTripDate(endDate));
}
