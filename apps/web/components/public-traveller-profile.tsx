'use client';

import { ArrowLeft, ChevronRight, Eye } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type CSSProperties } from 'react';

import { HomeSheet } from '@/components/home/home-front-door';
import { JourneyPrint, journeyPrints } from '@/components/journey-prints';
import {
  COVER_ACTION_CLASS,
  monthYear,
  ProfileCover,
  ProfileTravels,
  SECTION_TITLE,
} from '@/components/profile/traveller-profile';
import { Button } from '@/components/ui/button';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import type { TripMediaSource } from '@/lib/media/trip-media';
import { publicTripDayCount } from '@/lib/profile/public-travel-summary';
import { summarizeTravels, type TravelTrip } from '@/lib/profile/travel-summary';
import type {
  PublicTravellerProfile as PublicTravellerProfileData,
  PublicTravellerTrip,
} from '@/lib/public-trip/api';
import { profileInitials } from '@/lib/shell/floating-actions';
import { namedCountries } from '@/lib/trips/countries';

type PublicTravellerProfileProps = {
  isOwner: boolean;
  isSignedIn: boolean;
  profile: PublicTravellerProfileData;
  /** Date-only, from the server, so the counts agree between render and hydration. */
  today: string;
};

/** Trove's own artwork for a trip with no photograph of its own: a public page makes no editorial lookups. */
const TRIP_PRINT: TripMediaSource = { kind: 'fallback' };

/** A Public trip read the way the traveller's own profile reads one of theirs. */
function asTravelTrip(trip: PublicTravellerTrip, today: string): TravelTrip & { id: string } {
  return {
    ...trip,
    archivedAt: null,
    coverPhotoUrl: null,
    lifecycle: trip.endDate < today ? 'completed' : trip.startDate <= today ? 'active' : 'planning',
  };
}

/**
 * A traveller's profile as anyone sees it (PRD 8.3): the same page they see
 * themselves - cover, travel styles, travels at a glance, where they have been,
 * journeys and favourite moments - drawn only from their Public trips and those
 * trips' Memories, which is all the server sends. Each trip opens its shared
 * itinerary rather than their journal.
 *
 * Everything arrives as props from the server page; nothing here fetches.
 */
export function PublicTravellerProfile({
  isOwner,
  isSignedIn,
  profile,
  today,
}: Readonly<PublicTravellerProfileProps>) {
  const t = useTranslations('publicTraveller');
  const profileT = useTranslations('travellerProfile');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  useCoverUnderHeader();

  const { traveller, trips } = profile;
  const summary = useMemo(
    () => summarizeTravels(trips.map((trip) => asTravelTrip(trip, today))),
    [today, trips],
  );
  // Only a trip with its own photographs leads the cover; otherwise the cover
  // keeps Trove's artwork, as it would for a traveller with no Public trips.
  const coverTrip =
    summary.favourites[0] ?? summary.completed.find((trip) => trip.memoryPhotos?.length) ?? null;
  const home = traveller.homeCountryCode
    ? namedCountries([traveller.homeCountryCode], locale)[0]?.name
    : undefined;
  const sharedHref = (trip: { id: string }) => `/shared/${encodeURIComponent(trip.id)}`;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ProfileCover
        actions={
          isOwner ? (
            <Button
              className={COVER_ACTION_CLASS}
              nativeButton={false}
              render={<Link href="/profile" />}
              variant="outline"
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('ownerAction')}
            </Button>
          ) : null
        }
        avatarUrl={traveller.avatarUrl}
        bio={traveller.bio}
        coverPhotoUrl={traveller.coverPhoto?.url ?? null}
        coverPrint={coverTrip ? journeyPrints(coverTrip, null) : null}
        firstYear={summary.firstYear}
        home={home}
        initials={profileInitials(traveller.name) ?? '?'}
        name={traveller.name ?? t('anonymousName')}
      />

      <HomeSheet>
        {isOwner ? (
          <p className="flex items-center gap-2 rounded-[var(--radius-xl)] border border-border-subtle px-4 py-3 text-sm text-muted-foreground">
            <Eye aria-hidden="true" className="size-4 shrink-0" />
            {t('ownerNotice')}
          </p>
        ) : null}

        {traveller.travelStyles.length ? (
          <section aria-labelledby="traveller-styles" className="space-y-3">
            <h2 className={SECTION_TITLE} id="traveller-styles">
              {profileT('styles')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {traveller.travelStyles.map((style) => (
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

        {summary.completed.length ? (
          <ProfileTravels
            editorialFor={() => null}
            homeCountryCode={traveller.homeCountryCode}
            hrefFor={sharedHref}
            summary={summary}
            voice="public"
          />
        ) : null}

        <section aria-labelledby="traveller-trips" className="space-y-6">
          <h2 className={SECTION_TITLE} id="traveller-trips">
            {t('tripsTitle')}
          </h2>
          {trips.length ? (
            <ul className="space-y-7">
              {trips.map((trip, index) => {
                const countries = namedCountries(trip.countries, locale);
                const { prints } = journeyPrints({ coverPhotoUrl: null, ...trip }, null);
                const print = prints[0]?.kind === 'memory' ? prints[0] : TRIP_PRINT;

                return (
                  <li className="group relative flex items-center gap-4 sm:gap-6" key={trip.id}>
                    <span aria-hidden="true" className="w-24 shrink-0 sm:w-28">
                      <JourneyPrint
                        className="group-hover:rotate-0"
                        cover={TRIP_PRINT}
                        sizes="7rem"
                        source={print}
                        style={{ '--tilt': index % 2 ? '3deg' : '-3deg' } as CSSProperties}
                      />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-accent-strong uppercase tabular-nums">
                        {monthYear(trip.startDate, locale)} ·{' '}
                        {itineraryT('dayCount', { count: publicTripDayCount(trip) })}
                      </p>
                      <h3 className="font-journal text-[1.625rem] leading-[1.02] text-foreground [overflow-wrap:anywhere]">
                        <Link
                          className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius-lg)] focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
                          href={sharedHref(trip)}
                        >
                          {trip.name}
                        </Link>
                      </h3>
                      {countries.length ? (
                        <p className="text-sm text-muted-foreground">
                          {countries.map((country, countryIndex) => (
                            <span key={country.code}>
                              {countryIndex > 0 ? <span aria-hidden="true">{' · '}</span> : null}
                              <span aria-hidden="true">{country.flag} </span>
                              {country.name}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-[var(--radius-xl)] border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
              {isOwner ? t('emptyOwner') : t('empty')}
            </p>
          )}
        </section>

        {isSignedIn ? null : (
          <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xl)] border border-border-subtle px-4 py-4">
            <p className="text-sm text-muted-foreground">{t('footerPrompt')}</p>
            <Button nativeButton={false} render={<Link href="/sign-up" />} size="sm">
              {t('footerAction')}
            </Button>
          </footer>
        )}
      </HomeSheet>
    </div>
  );
}
