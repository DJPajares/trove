import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import type { PublicTravellerProfile as PublicTravellerProfileData } from '@/lib/public-trip/api';
import { namedCountries } from '@/lib/trips/countries';

type PublicTravellerProfileProps = {
  isOwner: boolean;
  isSignedIn: boolean;
  locale: string;
  profile: PublicTravellerProfileData;
};

/**
 * A traveller as anyone sees them: a name and the trips they made Public
 * (PRD 8.3). Each trip opens its shared itinerary, and says no more than that
 * itinerary does.
 *
 * A server component with no imagery: a cover would mean an editorial lookup
 * per trip on a page strangers can load at will, and the list reads fine as
 * text. It follows the shared itinerary's header and card treatment so the two
 * public pages feel like one place.
 */
export async function PublicTravellerProfile({
  isOwner,
  isSignedIn,
  locale,
  profile,
}: Readonly<PublicTravellerProfileProps>) {
  const t = await getTranslations('publicTraveller');
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
  const name = profile.traveller.name ?? t('anonymousName');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty">
          {name}
        </h1>
        {isOwner ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle px-4 py-3">
            <p className="flex-1 text-sm text-muted-foreground">{t('ownerNotice')}</p>
            <Button
              nativeButton={false}
              render={<Link href="/profile" />}
              size="sm"
              variant="secondary"
            >
              {t('ownerAction')}
            </Button>
          </div>
        ) : null}
      </header>

      <section aria-labelledby="traveller-trips-heading" className="flex flex-col gap-3">
        <h2
          className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
          id="traveller-trips-heading"
        >
          {t('tripsTitle')}
        </h2>
        {profile.trips.length ? (
          <ul className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)]">
            {profile.trips.map((trip, index) => {
              const countries = namedCountries(trip.countries, locale);

              return (
                <li
                  className={index > 0 ? 'border-t border-border-subtle' : undefined}
                  key={trip.id}
                >
                  <Link
                    className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none md:px-6"
                    href={`/shared/${encodeURIComponent(trip.id)}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-base leading-6 font-semibold text-pretty text-foreground">
                        {trip.name}
                      </p>
                      {countries.length ? (
                        <p className="mt-0.5 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
                          {countries.map((country, countryIndex) => (
                            <span key={country.code}>
                              {countryIndex > 0 ? <span aria-hidden="true">{' · '}</span> : null}
                              <span aria-hidden="true">{country.flag} </span>
                              {country.name}
                            </span>
                          ))}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[length:var(--text-metadata)] font-medium text-muted-foreground tabular-nums">
                        {t('dateRange', {
                          endDate: formatDate(trip.endDate),
                          startDate: formatDate(trip.startDate),
                        })}
                      </p>
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
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
    </div>
  );
}
