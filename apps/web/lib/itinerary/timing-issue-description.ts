import type { TimingIssue } from '@trove/types';

export function describeTimingIssue(
  issue: TimingIssue,
  options: {
    locale: string;
    hour12: boolean;
    nameFor: (id: string) => string;
    t: (key: string, values?: Record<string, string>) => string;
  },
) {
  const { t } = options;
  if (issue.code === 'NO_ROOM' && issue.suggestion?.status === 'ok')
    return t('connectedTiming.needsSpace');
  const context = issue.code === 'FIXED_CONFLICT' ? issue.orderConflict : undefined;
  if (!context?.earliestStartLocal || !context.scheduledStartLocal)
    return t(`connectedTiming.issue.${issue.code}`);
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
  const scheduled = new Date(`${context.scheduledStartLocal}:00Z`);
  const earliest = new Date(`${context.earliestStartLocal}:00Z`);
  const differentDate = date.format(scheduled) !== date.format(earliest);
  const format = (instant: Date) =>
    differentDate
      ? `${date.format(instant)}, ${formatter.format(instant)}`
      : formatter.format(instant);
  return t('connectedTiming.orderConflict', {
    previous: options.nameFor(context.previousItemId),
    earliest: format(earliest),
    scheduled: format(scheduled),
  });
}
