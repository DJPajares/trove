import type { TimingIssue } from '@trove/types';

type DescribeOptions = {
  locale: string;
  hour12: boolean;
  nameFor: (id: string) => string;
  t: (key: string, values?: Record<string, string>) => string;
};

/** Local wall-clock values: the API sends them without an offset, so they are read as UTC. */
function localClocks(values: readonly string[], options: DescribeOptions) {
  const formatter = new Intl.DateTimeFormat(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: options.hour12,
    timeZone: 'UTC',
  });
  const date = new Intl.DateTimeFormat(options.locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const instants = values.map((value) => new Date(`${value}:00Z`));
  const differentDate = new Set(instants.map((instant) => date.format(instant))).size > 1;
  return instants.map((instant) =>
    differentDate
      ? `${date.format(instant)}, ${formatter.format(instant)}`
      : formatter.format(instant),
  );
}

function duration(minutes: number, t: DescribeOptions['t']) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t('connectedTiming.minutes', { minutes: String(minutes) });
  return rest
    ? t('connectedTiming.hoursMinutes', { hours: String(hours), minutes: String(rest) })
    : t('connectedTiming.hours', { hours: String(hours) });
}

export function describeTimingIssue(issue: TimingIssue, options: DescribeOptions) {
  const { t } = options;
  if (issue.code === 'NO_ROOM' && issue.suggestion?.status === 'ok')
    return t('connectedTiming.needsSpace');

  // The cause, when the API knows it, says more than the issue's code.
  const booking = issue.bookingOverlap;
  if (booking) {
    const [start, end] = localClocks(
      booking.endLocal ? [booking.startLocal, booking.endLocal] : [booking.startLocal],
      options,
    );
    return t(end ? 'connectedTiming.bookingOverlap' : 'connectedTiming.bookingOverlapAt', {
      hasTitle: booking.title ? 'yes' : 'no',
      booking: booking.title ?? '',
      start: start!,
      ...(end ? { end } : {}),
    });
  }

  const shortfall = issue.travelShortfall;
  if (shortfall) {
    // The later stop starts before the earlier one: the trouble is the order, not
    // the gap between them, so say that rather than that one runs into the other.
    if (
      shortfall.limitedBy === 'fixed_start' &&
      shortfall.fromStartLocal &&
      shortfall.limitLocal < shortfall.fromStartLocal
    ) {
      const [toTime, fromTime] = localClocks(
        [shortfall.limitLocal, shortfall.fromStartLocal],
        options,
      );
      return t('connectedTiming.travelShortfallOrder', {
        from: options.nameFor(shortfall.fromItemId),
        fromTime: fromTime!,
        to: options.nameFor(shortfall.toItemId),
        toTime: toTime!,
      });
    }
    const [limitTime] = localClocks([shortfall.limitLocal], options);
    const values = {
      from: options.nameFor(shortfall.fromItemId),
      to: options.nameFor(shortfall.toItemId),
      travel: duration(shortfall.travelMinutes, t),
      available: duration(Math.max(0, shortfall.availableMinutes), t),
      limit: shortfall.limitedBy,
      limitName: shortfall.limitItemId ? options.nameFor(shortfall.limitItemId) : '',
      limitTime: limitTime!,
    };
    return t(
      shortfall.availableMinutes > 0
        ? 'connectedTiming.travelShortfall'
        : 'connectedTiming.travelShortfallOverlap',
      values,
    );
  }

  const context = issue.code === 'FIXED_CONFLICT' ? issue.orderConflict : undefined;
  if (!context?.earliestStartLocal || !context.scheduledStartLocal)
    return t(`connectedTiming.issue.${issue.code}`);
  const [earliest, scheduled] = localClocks(
    [context.earliestStartLocal, context.scheduledStartLocal],
    options,
  );
  return t('connectedTiming.orderConflict', {
    previous: options.nameFor(context.previousItemId),
    earliest: earliest!,
    scheduled: scheduled!,
  });
}
