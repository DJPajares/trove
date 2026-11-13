'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleAlert, MapPin, Pencil } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type CSSProperties } from 'react';

import { ExperienceRatingMark } from '@/components/experience-rating';
import { HOME_COVER_FRAME, HOME_SHEET, HomeSheet } from '@/components/home/home-front-door';
import { JourneyPrint, journeyPrints } from '@/components/journey-prints';
import { MediaFrame } from '@/components/media-frame';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import {
  editorialCoverImage,
  editorialSubjectKey,
  type EditorialImageReference,
} from '@/lib/media/editorial-images';
import {
  summarizeTravels,
  type CountryStamp,
  type VisitedPlace,
} from '@/lib/profile/travel-summary';
import { COUNTRY_CENTRES } from '@/lib/profile/country-centres';
import { projectToWorld, WORLD_VIEW, worldLandDots } from '@/lib/profile/world-dots';
import { queryKeys } from '@/lib/query/keys';
import { profileInitials } from '@/lib/shell/floating-actions';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { namedCountries } from '@/lib/trips/countries';
import { tripDayCount } from '@/lib/trips/facts';
import { tripEditorialSubject } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

const JOURNEY_LIMIT = 4;
const FAVOURITE_LIMIT = 8;

const SECTION_TITLE =
  'text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground';

function monthYear(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/** Room around the drawing, so dots on its edges and the arcs' peaks are never clipped. */
const MAP_PAD = 6;

/** A dotted arc between two points, bowed upwards like a flight path. */
function arcPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const lift = Math.abs(to.x - from.x) * 0.22 + 6;
  const peak = { x: (from.x + to.x) / 2, y: Math.max(-MAP_PAD + 1, Math.min(from.y, to.y) - lift) };
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${peak.x.toFixed(1)} ${peak.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/**
 * The places a traveller has been, drawn by Trove: land as a field of dots,
 * each visited place lit, and a dotted arc out to each from home - or, without
 * a home country, from one place to the next in the order they went. No map
 * provider, so no request and no terms.
 */
function TravelMap({
  homeCountryCode,
  places,
}: Readonly<{ homeCountryCode: string | null; places: VisitedPlace[] }>) {
  const t = useTranslations('travellerProfile.map');
  const locale = useLocale();
  const land = worldLandDots();
  const homeCentre = homeCountryCode ? COUNTRY_CENTRES[homeCountryCode] : undefined;
  const home = homeCentre ? projectToWorld(homeCentre[1], homeCentre[0]) : null;
  const points = places.map((place) => ({
    ...place,
    ...projectToWorld(place.longitude, place.latitude),
  }));
  const countryNames = new Map(
    namedCountries(
      places.flatMap(({ countryCode }) => countryCode ?? []),
      locale,
    ).map((country) => [country.code, country.name]),
  );
  const arcs = home
    ? points.map((point) => arcPath(home, point))
    : points
        .slice(1)
        .map((point, index) => arcPath(points[index] as (typeof points)[number], point));

  return (
    <figure className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-3 sm:p-5">
      <svg
        aria-label={t('label', { count: places.length })}
        className="block h-auto w-full"
        role="img"
        viewBox={`${-MAP_PAD} ${-MAP_PAD} ${WORLD_VIEW.width + MAP_PAD * 2} ${WORLD_VIEW.height + MAP_PAD * 2}`}
      >
        <g className="fill-muted-foreground/30">
          {land.map(({ x, y }) => (
            <circle cx={x.toFixed(1)} cy={y.toFixed(1)} key={`${x}:${y}`} r="1.25" />
          ))}
        </g>
        <g
          className="stroke-brand opacity-70"
          fill="none"
          strokeDasharray="1.6 1.8"
          strokeLinecap="round"
          strokeWidth="0.6"
        >
          {arcs.map((path) => (
            <path d={path} key={path} />
          ))}
        </g>
        <g className="fill-brand">
          {points.map((point) => (
            <g key={point.key}>
              <circle cx={point.x} cy={point.y} opacity="0.22" r="4.2" />
              <circle cx={point.x} cy={point.y} r="2">
                <title>
                  {point.countryCode
                    ? (countryNames.get(point.countryCode) ?? point.countryCode)
                    : point.name}
                </title>
              </circle>
            </g>
          ))}
        </g>
        {home ? (
          <circle
            className="fill-card stroke-accent-strong"
            cx={home.x}
            cy={home.y}
            r="3"
            strokeWidth="1.4"
          />
        ) : null}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[length:var(--text-metadata)] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
          {t('visited')}
        </span>
        {home ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-[1.5px] border-accent-strong"
            />
            {t('home')}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Stamp inks rotate through the palette's warm tones so a page of them reads as collected. */
const STAMP_INKS = [
  'text-brand border-brand',
  'text-accent-strong border-accent-strong',
  'text-rating border-rating',
];
const STAMP_TILTS = [-2, 2.5, -1.5, 1.5, -3, 2, -1, 3];

/** Each country once, as a passport stamp: its name, the year first visited, how many trips. */
function CountryStamps({ stamps }: Readonly<{ stamps: CountryStamp[] }>) {
  const t = useTranslations('travellerProfile.stamps');
  const locale = useLocale();
  const names = new Map(
    namedCountries(
      stamps.map(({ code }) => code),
      locale,
    ).map((country) => [country.code, country]),
  );

  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      {stamps.map((stamp, index) => (
        <li
          className={cn(
            'relative flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-lg)] border-2 bg-card/40 p-3 before:pointer-events-none before:absolute before:inset-1 before:rounded-[calc(var(--radius-lg)-4px)] before:border before:border-dashed before:border-current before:opacity-50 motion-safe:transition-transform motion-safe:hover:rotate-0',
            STAMP_INKS[index % STAMP_INKS.length],
          )}
          key={stamp.code}
          style={{ rotate: `${STAMP_TILTS[index % STAMP_TILTS.length]}deg` } as CSSProperties}
        >
          <span className="text-[0.625rem] font-bold tracking-[0.14em] uppercase tabular-nums">
            {t('since', { code: stamp.code, year: stamp.firstYear })}
          </span>
          <span className="font-journal text-[1.375rem] leading-none text-foreground [overflow-wrap:anywhere]">
            {names.get(stamp.code)?.name ?? stamp.code}
          </span>
          <span className="text-xs font-semibold tabular-nums">
            {t('trips', { count: stamp.trips })}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Journey({
  editorial,
  index,
  trip,
}: Readonly<{ editorial: EditorialImageReference | null; index: number; trip: Trip }>) {
  const t = useTranslations('travellerProfile.journeys');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const { cover, prints } = journeyPrints(trip, editorial);

  return (
    <li className="group relative flex items-center gap-4 sm:gap-6">
      <span aria-hidden="true" className="w-24 shrink-0 sm:w-28">
        <JourneyPrint
          className="group-hover:rotate-0"
          cover={cover}
          sizes="7rem"
          source={prints[0] ?? cover}
          style={{ '--tilt': index % 2 ? '3deg' : '-3deg' } as CSSProperties}
        />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-accent-strong uppercase tabular-nums">
          {monthYear(trip.startDate, locale)} ·{' '}
          {itineraryT('dayCount', { count: tripDayCount(trip) })}
        </p>
        <h3 className="font-journal text-[1.625rem] leading-[1.02] text-foreground [overflow-wrap:anywhere]">
          <Link
            className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius-lg)] focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
            href={`/trips/${trip.id}/memories`}
          >
            {trip.name}
          </Link>
        </h3>
        {trip.experienceNote?.trim() ? (
          <p className="line-clamp-2 font-journal text-lg leading-snug text-muted-foreground italic">
            {trip.experienceNote.trim()}
          </p>
        ) : null}
        {trip.experienceRating === null ? null : (
          <ExperienceRatingMark
            rating={trip.experienceRating}
            wordClassName="font-journal text-base text-foreground italic"
          />
        )}
        <span className="sr-only">{t('open')}</span>
      </div>
    </li>
  );
}

function ProfileSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className={cn('rounded-none', HOME_COVER_FRAME)} />
      <div aria-hidden="true" className={HOME_SHEET}>
        <Skeleton className="h-24 rounded-[var(--radius-2xl)]" />
        <Skeleton className="aspect-[12/5] rounded-[var(--radius-2xl)]" />
      </div>
    </div>
  );
}

/**
 * The traveller's profile: a page about them and where they have been, rather
 * than a form. Everything on it comes from the trips they have finished - the
 * countries, the journeys and their own words about them, the moments from the
 * trips they rated highest - read from the trips list the app already holds.
 * The settings that used to live here are at /settings, one tap away.
 */
export function TravellerProfile() {
  const t = useTranslations('travellerProfile');
  const glanceT = useTranslations('travellerProfile.glance');
  const locale = useLocale();
  const { profile } = usePreferences();
  const tripsQuery = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  useCoverUnderHeader();

  const summary = useMemo(
    () => summarizeTravels(tripsQuery.data?.trips ?? []),
    [tripsQuery.data?.trips],
  );
  const journeys = summary.completed.slice(0, JOURNEY_LIMIT);
  const favourites = summary.favourites.slice(0, FAVOURITE_LIMIT);
  const coverTrip = summary.favourites[0] ?? summary.completed[0] ?? null;

  // One capped request for every photograph the page may draw.
  const shownTrips = [coverTrip, ...journeys, ...favourites].filter((trip): trip is Trip =>
    Boolean(trip),
  );
  const editorialImages = useEditorialImages(
    shownTrips.flatMap((trip) => tripEditorialSubject(trip) ?? []),
  );
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject
      ? editorialCoverImage(editorialImages.get(editorialSubjectKey(subject)), trip.id)
      : null;
  };

  if (tripsQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <ProfileSkeleton label={t('loading')} />
      </div>
    );
  }

  if (!tripsQuery.data) {
    return (
      <PageState
        actions={<Button onClick={() => void tripsQuery.refetch()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const name = profile?.displayName?.trim() || t('anonymous');
  const initials = profileInitials(profile?.displayName) ?? '?';
  const home = profile?.homeCountryCode
    ? namedCountries([profile.homeCountryCode], locale)[0]?.name
    : undefined;
  const coverPrint = coverTrip ? journeyPrints(coverTrip, editorialFor(coverTrip)) : null;
  const mediaClass =
    'absolute inset-0 -z-20 h-full w-full rounded-none motion-safe:animate-in motion-safe:duration-[1400ms] motion-safe:ease-out motion-safe:zoom-in-105';

  const stats = [
    { count: summary.countries.length, key: 'countries' },
    { count: summary.cities, key: 'cities' },
    { count: summary.completed.length, key: 'trips' },
    { count: summary.daysAway, key: 'days' },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <section
        aria-labelledby="profile-heading"
        className={cn(
          'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
          HOME_COVER_FRAME,
        )}
        data-slot="profile-cover"
      >
        {profile?.coverPhoto ? (
          <TripMedia
            alt=""
            className={mediaClass}
            fallbackSources={coverPrint ? [coverPrint.prints[0] ?? coverPrint.cover] : []}
            preload
            sizes="100vw"
            source={{ kind: 'memory', url: profile.coverPhoto.url }}
            variant="cover"
          />
        ) : coverPrint ? (
          <TripMedia
            alt=""
            className={mediaClass}
            fallbackSources={coverPrint.prints[0] === coverPrint.cover ? [] : [coverPrint.cover]}
            preload
            sizes="100vw"
            source={coverPrint.prints[0] ?? coverPrint.cover}
            variant="cover"
          />
        ) : (
          <MediaFrame
            alt=""
            className={mediaClass}
            dataSlot="profile-cover-artwork"
            photographicPlaceholder={dayHeaderFallback.preview}
            preload
            sizes="100vw"
            source={{ kind: 'local', src: dayHeaderFallback.src }}
            variant="card"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.62)_0%,rgba(8,18,13,0.12)_28%,rgba(8,18,13,0.45)_56%,rgba(8,18,13,0.9)_100%)]"
        />

        <div className="mx-auto w-full max-w-[var(--layout-app)] ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)]">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-28 pb-14 motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4 md:flex-row md:items-end md:gap-6 md:pb-20">
            <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-on-media text-2xl font-semibold text-[oklch(0.21_0.04_55)] ring-3 ring-white/90 md:size-26 md:text-3xl">
              {profile?.avatarUrl ? (
                <Image
                  alt=""
                  className="size-full object-cover"
                  height={104}
                  src={profile.avatarUrl}
                  unoptimized
                  width={104}
                />
              ) : (
                <span aria-hidden="true">{initials}</span>
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h1
                className="font-journal text-[clamp(2.75rem,11vw,4.5rem)] leading-[0.95] font-normal tracking-[-0.01em] [overflow-wrap:anywhere]"
                id="profile-heading"
              >
                {name}
              </h1>
              {home || summary.firstYear ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/85">
                  {home ? (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin aria-hidden="true" className="size-4" />
                      {t('basedIn', { country: home })}
                    </span>
                  ) : null}
                  {home && summary.firstYear ? <span aria-hidden="true">·</span> : null}
                  {summary.firstYear ? (
                    <span>{t('travellingSince', { year: summary.firstYear })}</span>
                  ) : null}
                </p>
              ) : null}
              {profile?.bio ? (
                <p className="max-w-[36ch] font-journal text-xl leading-snug text-pretty text-white/92 italic">
                  {profile.bio}
                </p>
              ) : null}
            </div>
            <Button
              className="self-start rounded-full border-transparent bg-white/94 text-[oklch(0.285_0.039_47)] hover:bg-white md:self-end"
              nativeButton={false}
              render={<Link href="/settings" />}
              variant="outline"
            >
              <Pencil aria-hidden="true" data-icon="inline-start" />
              {t('editProfile')}
            </Button>
          </div>
        </div>
      </section>

      <HomeSheet>
        {profile?.travelStyles?.length ? (
          <section aria-labelledby="profile-styles" className="space-y-3">
            <h2 className={SECTION_TITLE} id="profile-styles">
              {t('styles')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {profile.travelStyles.map((style) => (
                <li
                  className="inline-flex h-9 items-center rounded-full bg-secondary px-4 text-sm font-medium text-secondary-foreground"
                  key={style}
                >
                  {style}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {summary.completed.length === 0 ? (
          <PageState
            actions={
              <Button nativeButton={false} render={<Link href="/trips" />}>
                {t('empty.action')}
              </Button>
            }
            description={t('empty.description')}
            headingLevel={2}
            kind="empty"
            title={t('empty.title')}
          />
        ) : (
          <>
            <section aria-labelledby="profile-glance" className="space-y-4">
              <h2 className={SECTION_TITLE} id="profile-glance">
                {glanceT('title')}
              </h2>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-border-subtle sm:grid-cols-5">
                {stats.map(({ count, key }) => (
                  <div className="flex flex-col-reverse gap-0.5 bg-card p-4" key={key}>
                    <dt className="text-[length:var(--text-metadata)] text-muted-foreground">
                      {glanceT(key, { count })}
                    </dt>
                    <dd className="text-[1.75rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
                      {count.toLocaleString(locale)}
                    </dd>
                  </div>
                ))}
                {summary.firstYear ? (
                  <div className="col-span-2 flex flex-col-reverse gap-0.5 bg-card p-4 sm:col-span-1">
                    <dt className="text-[length:var(--text-metadata)] text-muted-foreground">
                      {glanceT('firstTrip')}
                    </dt>
                    <dd className="text-[1.75rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">
                      {summary.firstYear}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section aria-labelledby="profile-map" className="space-y-4">
              <h2 className={SECTION_TITLE} id="profile-map">
                {t('map.title')}
              </h2>
              <TravelMap
                homeCountryCode={profile?.homeCountryCode ?? null}
                places={summary.places}
              />
              {summary.countries.length ? <CountryStamps stamps={summary.countries} /> : null}
            </section>

            <section aria-labelledby="profile-journeys" className="space-y-6">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className={SECTION_TITLE} id="profile-journeys">
                  {t('journeys.title')}
                </h2>
                <Link
                  className="group inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                  href="/trips?show=past"
                >
                  {t('journeys.all', { count: summary.completed.length })}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
              <ul className="space-y-7">
                {journeys.map((trip, index) => (
                  <Journey editorial={editorialFor(trip)} index={index} key={trip.id} trip={trip} />
                ))}
              </ul>
            </section>

            {favourites.length ? (
              <section aria-labelledby="profile-favourites" className="space-y-4">
                <div className="space-y-1">
                  <h2 className={SECTION_TITLE} id="profile-favourites">
                    {t('favourites.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">{t('favourites.description')}</p>
                </div>
                <ul className="-ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] flex snap-x gap-3 overflow-x-auto ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
                  {favourites.map((trip) => {
                    const { cover, prints } = journeyPrints(trip, editorialFor(trip));
                    return (
                      <li className="w-40 shrink-0 snap-start md:w-auto" key={trip.id}>
                        <Link
                          className="group relative isolate flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-[var(--radius-2xl)] bg-surface-media p-3.5 text-white shadow-[var(--shadow-card)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          href={`/trips/${trip.id}/memories`}
                        >
                          <TripMedia
                            alt=""
                            className="absolute inset-0 -z-20 h-full w-full rounded-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                            fallbackSources={prints[0] === cover ? [] : [cover]}
                            sizes="(max-width: 767px) 160px, 15rem"
                            source={prints[0] ?? cover}
                            variant="card"
                          />
                          <span
                            aria-hidden="true"
                            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_45%,rgba(8,18,13,0.88)_100%)]"
                          />
                          <span className="line-clamp-2 font-journal text-lg leading-[1.05]">
                            {trip.name}
                          </span>
                          {trip.experienceRating === null ? null : (
                            <ExperienceRatingMark
                              className="mt-1"
                              rating={trip.experienceRating}
                              tone="onImage"
                              wordClassName="sr-only"
                            />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </HomeSheet>
    </div>
  );
}
