'use client';

import { ArrowLeft, ChevronRight, Eye } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';

import { HomeSheet } from '@/components/home/home-front-door';
import { JourneyPrint } from '@/components/journey-prints';
import {
  CountryStamps,
  COVER_ACTION_CLASS,
  monthYear,
  ProfileCover,
  SECTION_TITLE,
  TravelGlance,
  TravelMap,
} from '@/components/profile/traveller-profile';
import { UnlistedPublicTrips } from '@/components/profile/unlisted-public-trips';
import { Button } from '@/components/ui/button';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import type { TripMediaSource } from '@/lib/media/trip-media';
import {
  publicTravelMap,
  publicTripDayCount,
  summarizePublicTravels,
} from '@/lib/profile/public-travel-summary';
import type { PublicTravellerProfile as PublicTravellerProfileData } from '@/lib/public-trip/api';
import { profileInitials } from '@/lib/shell/floating-actions';
import { namedCountries } from '@/lib/trips/countries';

type PublicTravellerProfileProps = {
  isOwner: boolean;
  isSignedIn: boolean;
  profile: PublicTravellerProfileData;
  /** Date-only, from the server, so the counts agree between render and hydration. */
  today: string;
};

/**
 * Trove's own artwork stands in for every trip's photograph: a public page that
 * anyone can load at will makes no editorial lookups, and a trip's own cover
 * and Memories are not part of what its link shares (PRD 8.2, 8.3).
 */
const TRIP_PRINT: TripMediaSource = { kind: 'fallback' };

/**
 * A traveller's public view (PRD 8.3): the same cover and sheet as their own
 * profile, holding only what they share with everyone - their name, photo,
 * cover, bio and home country, counts from their Public trips, and those trips,
 * each opening its shared itinerary.
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
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  useCoverUnderHeader();

  const { traveller, trips } = profile;
  const summary = summarizePublicTravels(trips, today);
  const travelMap = publicTravelMap(trips, today);
  const home = traveller.homeCountryCode
    ? namedCountries([traveller.homeCountryCode], locale)[0]?.name
    : undefined;

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
        coverPrint={null}
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

        {summary.trips ? (
          <TravelGlance
            firstYear={summary.firstYear}
            stats={[
              { count: summary.countries, key: 'countries' },
              { count: summary.trips, key: 'trips' },
              { count: summary.daysAway, key: 'days' },
            ]}
          />
        ) : null}

        {/* Where they have been, from their listed Public trips' countries only. */}
        {travelMap.places.length ? (
          <section aria-labelledby="traveller-map" className="space-y-4">
            <h2 className={SECTION_TITLE} id="traveller-map">
              {t('mapTitle')}
            </h2>
            <TravelMap
              homeCountryCode={traveller.homeCountryCode}
              messages="publicTraveller.map"
              places={travelMap.places}
            />
            <CountryStamps stamps={travelMap.stamps} />
          </section>
        ) : null}

        {isOwner ? <UnlistedPublicTrips /> : null}

        <section aria-labelledby="traveller-trips" className="space-y-6">
          <h2 className={SECTION_TITLE} id="traveller-trips">
            {t('tripsTitle')}
          </h2>
          {trips.length ? (
            <ul className="space-y-7">
              {trips.map((trip, index) => {
                const countries = namedCountries(trip.countries, locale);

                return (
                  <li className="group relative flex items-center gap-4 sm:gap-6" key={trip.id}>
                    <span aria-hidden="true" className="w-24 shrink-0 sm:w-28">
                      <JourneyPrint
                        className="group-hover:rotate-0"
                        cover={TRIP_PRINT}
                        sizes="7rem"
                        source={TRIP_PRINT}
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
                          href={`/shared/${encodeURIComponent(trip.id)}`}
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
