type TimedItineraryItem = {
  durationMinutes: number | null;
  localEndTime?: string | null;
  localStartTime: string | null;
};

export function itineraryLocalEndTime(item: TimedItineraryItem) {
  if (!item.localStartTime) return null;
  if (item.localEndTime) return item.localEndTime;
  if (!item.durationMinutes) return null;

  const [hour = 0, minute = 0] = item.localStartTime.split(':').map(Number);
  const totalMinutes = (hour * 60 + minute + item.durationMinutes) % (24 * 60);

  return `${Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0')}:${(totalMinutes % 60).toString().padStart(2, '0')}`;
}

/**
 * `locale` leaves the choice to `Intl`, for readers with no preference to honour
 * - a visitor on a shared itinerary has no profile to have set one in.
 */
export type ItineraryTimeFormat = '12h' | '24h' | 'locale';

export function formatItineraryTimeRange(
  item: TimedItineraryItem,
  locale: string,
  timeFormat: ItineraryTimeFormat,
) {
  if (!item.localStartTime) return null;

  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    ...(timeFormat === 'locale' ? {} : { hour12: timeFormat === '12h' }),
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const formatTime = (value: string) => {
    const [hour = 0, minute = 0] = value.split(':').map(Number);
    return formatter.format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  };
  const start = formatTime(item.localStartTime);
  const localEndTime = itineraryLocalEndTime(item);

  return localEndTime ? `${start} - ${formatTime(localEndTime)}` : start;
}
