import { cn } from '@/lib/utils';

/** Beyond this a day per segment stops reading as days and starts reading as a texture. */
const MAX_DAY_SEGMENTS = 21;

/**
 * The days of a trip under way, one segment each: the ones lived, today, and
 * the ones still to come. Drawn over a photograph, and always beside words
 * saying the same ("Day 3 of 5"), so it is for the eye only.
 */
export function TripDaySegments({
  className,
  day,
  total,
}: Readonly<{ className?: string; day: number; total: number }>) {
  if (total > MAX_DAY_SEGMENTS) {
    return (
      <span
        aria-hidden="true"
        className={cn('block h-1 w-full overflow-hidden rounded-full bg-white/22', className)}
      >
        <span
          className="block h-full rounded-full bg-primary-on-media"
          style={{ width: `${(day / total) * 100}%` }}
        />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={cn('flex w-full gap-1', className)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          className={cn(
            'h-1 flex-1 rounded-full',
            index + 1 < day && 'bg-white/70',
            index + 1 === day && 'bg-primary-on-media shadow-[0_0_12px_oklch(0.78_0.085_115/0.7)]',
            index + 1 > day && 'bg-white/22',
          )}
          key={index}
        />
      ))}
    </span>
  );
}
