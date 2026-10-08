'use client';

import { CircleCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { TripCountries } from '@/components/trip-countries';
import { TripMedia } from '@/components/trip-media';
import { Progress } from '@/components/ui/progress';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { formatTripDateRange } from '@/lib/trips/format';
import { groupAheadByMonth, tripDayProgress, type AheadGroup } from '@/lib/trips/library';
import { daysUntilTripStart, getLocalDate, resolveCountdown } from '@/lib/trips/lifecycle';
import { tripDestinationSummary } from '@/lib/trips/summary';

const KICKER =
  'text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-text-subtle uppercase';

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** "November", or "January 2027" once the month is in another year than today's. */
function monthHeading(month: string, locale: string, now: Date) {
  const sameYear = month.slice(0, 4) === getLocalDate(now, 'UTC').slice(0, 4);

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(utcDate(`${month}-01`));
}

/** "in 3 weeks", "tomorrow" - the language's own phrasing, not Trove's. */
function departsIn(trip: Trip, locale: string) {
  const countdown = resolveCountdown(daysUntilTripStart(trip));

  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    countdown.value,
    countdown.unit,
  );
}

/**
 * The calendar leaf in the corner of a ticket: the weekday and the date it
 * leaves on, or the day a trip under way has reached. The ticket's own footer
 * says the same in words, so the leaf is for the eye.
 */
function DateLeaf({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.ahead');
  const locale = useLocale();
  const start = utcDate(trip.startDate);

  const [top, bottom] =
    trip.lifecycle === 'active'
      ? [t('dayKicker'), String(tripDayProgress(trip).day).padStart(2, '0')]
      : [
          new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(start),
          String(start.getUTCDate()).padStart(2, '0'),
        ];

  return (
    <span
      aria-hidden="true"
      className="absolute top-3 left-3 flex min-w-12 flex-col items-center rounded-[var(--radius-md)] bg-background/92 px-2 pt-1 pb-1.5 text-foreground shadow-[var(--shadow-control)] backdrop-blur-sm"
    >
      <span className="text-[0.625rem] leading-4 font-semibold tracking-[0.14em] text-accent-strong uppercase">
        {top}
      </span>
      <span className="text-xl leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {bottom}
      </span>
    </span>
  );
}

/**
 * How much of a trip has a plan, as a fraction and a short bar - the same
 * itinerary coverage the trip's own screens describe, compact enough to sit in
 * a ticket's footer (PRD 9.2).
 */
function CoverageMeter({
  coverage,
}: Readonly<{ coverage: NonNullable<Trip['itineraryCoverage']> }>) {
  const t = useTranslations('trips.library.ahead');
  const coverageT = useTranslations('itineraryCoverage');
  const locale = useLocale();

  return (
    <Progress.Root
      aria-valuetext={coverageT('announcement', coverage)}
      className="flex shrink-0 items-center gap-2"
      locale={locale}
      value={coverage.percentage}
    >
      <Progress.Label className="text-muted-foreground tabular-nums">
        {t('planned', coverage)}
      </Progress.Label>
      <Progress.Track className="h-1 w-12 overflow-hidden rounded-full bg-primary/20">
        <Progress.Indicator className="rounded-full bg-primary" />
      </Progress.Track>
    </Progress.Root>
  );
}

function TicketStatus({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.library.ahead');
  const tripsT = useTranslations('trips');

  if (trip.lifecycle === 'active') {
    const { day, total } = tripDayProgress(trip);
    return (
      <span className="shrink-0 font-medium text-brand tabular-nums">
        {t('dayProgress', { day, total })}
      </span>
    );
  }

  // Ready is the traveller's own word for the plan, so it replaces the measure
  // rather than sitting beside it (PRD 6.2, 9.2).
  if (trip.planningReadiness === 'ready') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-status-success">
        <CircleCheck aria-hidden="true" className="size-3.5" />
        {tripsT('readinessState.ready')}
      </span>
    );
  }

  return trip.itineraryCoverage ? <CoverageMeter coverage={trip.itineraryCoverage} /> : null;
}

/**
 * One trip ahead, as a ticket: its photograph with the date it leaves on and
 * its name, then a single line of what it is - when, how long, how planned.
 * The whole ticket opens the trip, whose overview leads with planning.
 */
function AheadTicket({
  editorial,
  trip,
}: Readonly<{ editorial: EditorialImageReference | null; trip: Trip }>) {
  const t = useTranslations('trips.library.ahead');
  const itineraryT = useTranslations('itinerary');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const subject = tripDestinationSummary(trip) ?? trip.name;
  const when = trip.lifecycle === 'active' ? t('underway') : departsIn(trip, locale);

  return (
    <article
      className="group relative isolate flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-within:border-border-strong hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-elevated)] motion-reduce:transform-none motion-reduce:transition-none"
      data-slot="library-ticket"
    >
      <div className="relative aspect-[2/1] md:aspect-[4/3]">
        <TripMedia
          alt={editorial ? mediaT('alt.tripEditorial', { name: subject }) : ''}
          className="absolute inset-0 -z-10 h-full w-full rounded-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          sizes="(max-width: 767px) 92vw, (max-width: 1023px) 46vw, 20rem"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_38%,rgba(8,18,13,0.5)_64%,rgba(8,18,13,0.88)_100%)]"
        />
        <DateLeaf trip={trip} />
        <div className="absolute inset-x-0 bottom-0 space-y-1 p-4 text-white">
          {trip.countries?.length ? (
            <TripCountries
              className="block truncate text-[0.6875rem] font-semibold tracking-[0.12em] text-white/85 uppercase"
              countries={trip.countries}
            />
          ) : null}
          <h4 className="line-clamp-2 text-lg leading-[1.15] font-semibold tracking-[-0.02em] text-balance">
            <Link
              className="rounded-[var(--radius-sm)] outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:ring-3 focus-visible:ring-ring/50"
              href={`/trips/${trip.id}`}
            >
              {trip.name}
            </Link>
          </h4>
        </div>
      </div>

      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-[length:var(--text-metadata)]">
        <span className="min-w-0 truncate text-muted-foreground tabular-nums">
          <span className="inline-block font-medium text-foreground first-letter:uppercase">
            {when}
          </span>
          <span aria-hidden="true"> · </span>
          {itineraryT('dayCount', { count: tripDayCount(trip) })}
          {/* The leaf in the photograph's corner is drawn for the eye; the
              dates themselves are said here. */}
          <span className="sr-only">
            {`, ${formatTripDateRange(trip.startDate, trip.endDate, locale)}`}
          </span>
        </span>
        <TicketStatus trip={trip} />
      </div>
    </article>
  );
}

function GroupHeading({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <h3 className={`flex items-center gap-3 ${KICKER}`}>
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
    </h3>
  );
}

export type LibraryAheadProps = {
  editorialFor: (trip: Trip) => EditorialImageReference | null;
  /** Rendered first, before any month - the AI draft waiting to become a trip. */
  leading?: ReactNode;
  onCreateTrip: () => void;
  trips: Trip[];
};

/**
 * Everything still ahead, after the trip the library leads with: a calendar
 * of departures read down the page, month by month, every trip a ticket.
 *
 * Readiness marks a ticket and never moves it - the order is the order the
 * traveller leaves in (PRD 6.2). A second trip already under way sits above
 * the months under its own heading, because it belongs to now. The calendar
 * ends on an open slot, the next trip not yet planned.
 */
export function LibraryAhead({
  editorialFor,
  leading,
  onCreateTrip,
  trips,
}: Readonly<LibraryAheadProps>) {
  const t = useTranslations('trips.library.ahead');
  const locale = useLocale();
  const now = new Date();
  const groups: AheadGroup[] = groupAheadByMonth(trips);

  return (
    <section
      aria-labelledby="library-ahead-heading"
      className="space-y-6"
      data-slot="library-ahead"
    >
      <h2
        className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
        id="library-ahead-heading"
      >
        {t('title')}
      </h2>

      {leading}

      {groups.length ? (
        <ol className="space-y-8">
          {groups.map((group) => (
            <li className="space-y-4" key={group.key}>
              <GroupHeading>
                {group.kind === 'now' ? t('now') : monthHeading(group.month, locale, now)}
              </GroupHeading>
              <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.trips.map((trip) => (
                  <li key={trip.id}>
                    <AheadTicket editorial={editorialFor(trip)} trip={trip} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}

      <button
        className="group flex w-full items-center gap-4 rounded-[var(--radius-xl)] border border-dashed border-border-strong px-4 py-4 text-start outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:border-brand/60 hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        onClick={onCreateTrip}
        type="button"
      >
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-raised text-brand shadow-[var(--shadow-control)] transition-transform duration-[var(--motion-standard)] group-hover:rotate-90 motion-reduce:transition-none motion-reduce:group-hover:rotate-0"
        >
          <Plus className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-foreground">{t('whereNext')}</span>
          <span className="block text-sm text-muted-foreground">{t('whereNextDescription')}</span>
        </span>
      </button>
    </section>
  );
}
