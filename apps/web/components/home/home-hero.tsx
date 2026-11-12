'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { HOME_COVER_FRAME, HomeHeadline } from '@/components/home/home-front-door';
import { HomeNowStrip } from '@/components/home-now-strip';
import { MediaFrame } from '@/components/media-frame';
import { TripCountries } from '@/components/trip-countries';
import { TripDaySegments } from '@/components/trip-day-segments';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { formatTripDateRange } from '@/lib/trips/format';
import { tripDayProgress } from '@/lib/trips/library';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

/**
 * Home's cover: the photograph of where the traveller is going, with the
 * page's one sentence about right now set on it.
 *
 * With a lead trip it is that trip's own cover or editorial photograph, and
 * the trip's name in the headline opens the trip from anywhere on the
 * photograph. With none it is Trove's bundled artwork: there is no subject to
 * ask a photograph of, and nothing here should cost a request.
 */
export function HomeCover({
  editorial,
  headline,
  trip,
}: Readonly<{
  editorial: EditorialImageReference | null;
  headline: { lead: string; subject: string };
  trip: Trip | null;
}>) {
  const t = useTranslations('home.hero');
  const mediaT = useTranslations('media');
  const locale = useLocale();
  const active = trip?.lifecycle === 'active';

  // The header and the floating controls take the photograph's ink only while
  // the page rests at its top (globals.css reads this flag). Once the cover's
  // own words start to scroll beneath them they need their surface back.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (window.scrollY <= 16) root.setAttribute('data-cover-under-header', 'true');
      else root.removeAttribute('data-cover-under-header');
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => {
      window.removeEventListener('scroll', sync);
      root.removeAttribute('data-cover-under-header');
    };
  }, []);

  const mediaClass =
    'absolute inset-0 -z-20 h-full w-full rounded-none motion-safe:animate-in motion-safe:duration-[1400ms] motion-safe:ease-out motion-safe:zoom-in-105';

  return (
    <section
      aria-labelledby="home-heading"
      className={cn(
        'relative isolate flex flex-col overflow-hidden bg-surface-media text-white',
        HOME_COVER_FRAME,
      )}
      data-slot="home-cover"
    >
      {trip ? (
        <TripMedia
          alt={
            editorial
              ? mediaT('alt.tripEditorial', { name: tripDestinationSummary(trip) ?? trip.name })
              : ''
          }
          className={mediaClass}
          preload
          sizes="100vw"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="card"
        />
      ) : (
        <MediaFrame
          alt=""
          className={mediaClass}
          dataSlot="home-cover-artwork"
          photographicPlaceholder={dayHeaderFallback.preview}
          preload
          sizes="100vw"
          source={{ kind: 'local', src: dayHeaderFallback.src }}
          variant="card"
        />
      )}
      {/* Fixed in both themes, so the headline never depends on the photograph. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,18,13,0.62)_0%,rgba(8,18,13,0.14)_28%,rgba(8,18,13,0.4)_56%,rgba(8,18,13,0.9)_100%)]"
      />

      {/* The page's own measure inside the full-width photograph: the weather
          cue at the top, clear of the status area or the header, and the
          moment at the foot, clear of the sheet that overlaps it. */}
      <div className="mx-auto flex w-full max-w-[var(--layout-app)] flex-1 flex-col ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)]">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-between gap-12 pt-[calc(var(--safe-top)+0.75rem)] pb-14 md:pt-[calc(var(--safe-top)+var(--header-height)+1.25rem)] md:pb-20">
          {/* Above the headline's stretched link, so the weather source stays its own link. */}
          <div className="relative z-10 self-start motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in">
            <HomeNowStrip tone="onMedia" />
          </div>

          <div className="space-y-3">
            {trip ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
                <span className="inline-flex items-center gap-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/80 uppercase">
                  {active ? (
                    <span aria-hidden="true" className="relative flex size-2">
                      <span className="absolute inset-0 animate-ping rounded-full bg-primary-on-media/70 motion-reduce:animate-none" />
                      <span className="relative size-2 rounded-full bg-primary-on-media" />
                    </span>
                  ) : null}
                  {t(`kicker.${trip.lifecycle}`)}
                </span>
                <TripReadinessBadge
                  lifecycle={trip.lifecycle}
                  readiness={trip.planningReadiness}
                  tone="onMedia"
                />
              </div>
            ) : null}

            <HomeHeadline
              href={trip ? `/trips/${trip.id}` : undefined}
              lead={headline.lead}
              subject={headline.subject}
            />

            {trip ? (
              <div className="space-y-3 motion-safe:animate-in motion-safe:fill-mode-both motion-safe:delay-200 motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4">
                {active ? (
                  <TripDaySegments
                    className="max-w-xs"
                    day={tripDayProgress(trip).day}
                    total={tripDayCount(trip)}
                  />
                ) : null}
                <div className="space-y-1">
                  {trip.countries?.length ? (
                    <TripCountries
                      className="block truncate text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-white/85 uppercase"
                      countries={trip.countries}
                    />
                  ) : null}
                  <p className="text-sm font-medium text-white/90 tabular-nums">
                    {formatTripDateRange(trip.startDate, trip.endDate, locale)}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
