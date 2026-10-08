'use client';

import { useLocale } from 'next-intl';

/**
 * A chapter's date stamp, in terracotta ink: the day of the month large, the
 * month beneath it, and the town the day happened in when it is known. It
 * repeats what the chapter's heading already says, so it is decoration to
 * assistive tech - a mark on the page, not information.
 */
export function DateStamp({ date, place }: Readonly<{ date: string; place: string | null }>) {
  const locale = useLocale();
  const day = new Date(`${date}T00:00:00.000Z`);
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(day);
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(
    day,
  );

  return (
    <span
      aria-hidden="true"
      className="relative flex size-[5.5rem] shrink-0 -rotate-[7deg] flex-col items-center justify-center rounded-full border-[1.5px] border-accent-strong/75 text-accent-strong opacity-90 outline outline-1 outline-offset-[3px] outline-accent-strong/35"
      data-slot="journal-date-stamp"
    >
      <span className="text-[0.55rem] leading-none font-semibold tracking-[0.2em] uppercase">
        {weekday}
      </span>
      <span className="font-journal text-[2rem] leading-[1] font-normal tabular-nums">
        {day.getUTCDate()}
      </span>
      <span className="text-[0.6rem] leading-none font-semibold tracking-[0.2em] uppercase">
        {month}
      </span>
      {place ? (
        <span className="mt-1 max-w-[4.25rem] truncate text-[0.5rem] leading-none font-semibold tracking-[0.18em] uppercase">
          {place}
        </span>
      ) : null}
    </span>
  );
}
