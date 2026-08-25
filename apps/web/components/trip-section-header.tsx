'use client';

import { ArrowLeft, ChevronDown, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { HeaderDensity } from '@/components/page-header';
import { TripMedia } from '@/components/trip-media';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource, type TripMediaSource } from '@/lib/media/trip-media';
import { fetchTrip, type Trip } from '@/lib/trips/api';
import {
  primaryTripDestinations,
  supportingTripDestinations,
  tripSectionLabelKey,
  type TripDestination,
  type TripSection,
} from '@/lib/trips/navigation';
import { tripEditorialSubject } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';

export type { TripSection };

type TripSectionHeaderProps = {
  actions?: ReactNode;
  coverMeta?: ReactNode;
  coverSource?: TripMediaSource;
  currentSection: TripSection;
  density?: HeaderDensity;
  description?: string;
  media?: ReactNode;
  meta?: ReactNode;
  showCover?: boolean;
  trip?: Trip;
  tripId: string;
};

function emphasisClasses(destination: TripDestination, active: boolean) {
  if (active) return 'text-foreground';
  if (destination.emphasis === 'leading') {
    return 'text-foreground hover:bg-surface-hover';
  }
  if (destination.emphasis === 'quiet') {
    return 'text-text-subtle hover:bg-surface-hover hover:text-foreground';
  }
  return 'text-muted-foreground hover:bg-surface-hover hover:text-foreground';
}

/**
 * The header every trip page shares. The trip is the subject — its name is the
 * heading wherever you are inside it — and the three experiences Trove is built
 * around are the only destinations on show. Everything else a trip needs stays one
 * interaction away rather than competing for the same attention.
 */
export function TripSectionHeader({
  actions,
  coverMeta,
  coverSource,
  currentSection,
  density = 'default',
  description,
  media,
  meta,
  showCover = false,
  trip: suppliedTrip,
  tripId,
}: Readonly<TripSectionHeaderProps>) {
  const t = useTranslations('trips');
  const locale = useLocale();
  const [loadedTrip, setLoadedTrip] = useState<{ trip: Trip; tripId: string } | null>(null);

  useEffect(() => {
    if (suppliedTrip?.id === tripId) return;

    let active = true;
    void fetchTrip(tripId)
      .then((result) => {
        if (active) setLoadedTrip({ trip: result.trip, tripId });
      })
      // Navigation must never be the thing that breaks: without the trip the
      // header simply loses its name and dates.
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [suppliedTrip, tripId]);

  const trip =
    suppliedTrip?.id === tripId
      ? suppliedTrip
      : loadedTrip?.tripId === tripId
        ? loadedTrip.trip
        : null;

  const coverSubject = showCover && trip && !coverSource ? tripEditorialSubject(trip) : null;
  const editorialImages = useEditorialImages(coverSubject ? [coverSubject] : []);
  const editorial = coverSubject
    ? (editorialImages.get(editorialSubjectKey(coverSubject))?.[0] ?? null)
    : null;

  const lifecycle = trip?.lifecycle ?? 'planning';
  const primary = primaryTripDestinations(tripId, lifecycle, trip?.startDate ?? '');
  const supporting = supportingTripDestinations(tripId);
  const activeSupporting = supporting.find((entry) => entry.section === currentSection);
  const onCoreExperience = primary.some((entry) => entry.section === currentSection);
  // Places is reached from the itinerary rather than from the menu, so it belongs to
  // neither set. It is still a screen the traveller can be standing on, and a header
  // that reads "More" there tells them nothing about where they are.
  const currentLabel = activeSupporting
    ? t(activeSupporting.labelKey)
    : onCoreExperience
      ? undefined
      : t(tripSectionLabelKey(currentSection));

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );

  return (
    <header
      className={cn('space-y-5', density === 'compact' && 'space-y-3 sm:space-y-5')}
      data-density={density}
      data-slot="trip-section-header"
    >
      {showCover && trip ? (
        <section
          aria-labelledby="trip-section-cover-heading"
          className="relative isolate -mx-[var(--gutter-inline-start)] -mt-8 md:mx-0 md:mt-0"
        >
          <TripMedia
            alt={t('coverImageAlt', { name: trip.name })}
            className="max-h-[58dvh] w-full rounded-none md:rounded-[var(--radius-2xl)]"
            preload
            sizes="(max-width: 1023px) 100vw, 1024px"
            source={
              coverSource ?? resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })
            }
            variant="hero"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-2 bg-gradient-to-t from-surface-overlay from-20% via-surface-overlay/55 to-transparent p-5 md:rounded-[var(--radius-2xl)] md:p-7">
            <h1
              className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-media-fallback-foreground"
              id="trip-section-cover-heading"
            >
              {trip.name}
            </h1>
            <p className="text-[length:var(--text-metadata)] font-medium text-media-fallback-foreground/85 tabular-nums">
              {t('dateRange', {
                endDate: formatDate(trip.endDate),
                startDate: formatDate(trip.startDate),
              })}
              {' · '}
              {t(`lifecycle.${trip.lifecycle}`)}
            </p>
            {coverMeta ? <div className="pointer-events-auto -ml-1">{coverMeta}</div> : null}
          </div>
          <Link
            aria-label={t('backToTrips')}
            className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 flex size-10 items-center justify-center rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm outline-none transition-colors hover:bg-neutral-950/78 focus-visible:ring-3 focus-visible:ring-ring/50"
            href="/trips"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Link>
        </section>
      ) : (
        <Link
          className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          href="/trips"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('title')}
        </Link>
      )}

      <div
        className={cn(
          'grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]',
          density === 'immersive' && 'md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.6fr)] md:gap-10',
        )}
      >
        {showCover ? null : (
          <div className="min-w-0 max-w-[var(--layout-reading)]">
            <h1
              className={cn(
                'text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-foreground',
                density === 'immersive' &&
                  'md:text-[length:var(--text-immersive-title)] md:leading-[1.02]',
                // On a working screen the trip's name is orientation, not the
                // headline: the traveller came for what is inside the trip, and a
                // phone only has so many rows to give.
                density === 'compact' &&
                  'text-[length:var(--text-section-title)] leading-[1.15] sm:text-[length:var(--text-page-title)] sm:leading-[1.08]',
              )}
            >
              {trip?.name ?? t('titleLoading')}
            </h1>
            {trip ? (
              <p className="mt-2 text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
                {t('dateRange', {
                  endDate: formatDate(trip.endDate),
                  startDate: formatDate(trip.startDate),
                })}
                {' · '}
                {t(`lifecycle.${trip.lifecycle}`)}
              </p>
            ) : null}
            {meta ? (
              <div className="mt-2 text-[length:var(--text-metadata)] leading-5 font-medium text-text-subtle tabular-nums">
                {meta}
              </div>
            ) : null}
            {density === 'compact' && actions && !media ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 sm:hidden">{actions}</div>
            ) : null}
          </div>
        )}
        {media ? (
          <div className="min-w-0">
            {media}
            {actions ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </div>
        ) : actions ? (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center gap-2',
              density === 'compact' && 'hidden sm:flex',
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-border-subtle">
        <nav aria-label={t('tripNavigation')} className="min-w-0">
          {/* `overflow-x-auto` also clips vertically, which would cut the tabs'
              focus ring. The negative margin buys it room without moving the
              margin box, so each tab's active underline stays welded to the
              section border below. */}
          <ul className="-m-1 flex items-center gap-1 overflow-x-auto p-1">
            {primary.map((destination) => {
              const active = destination.section === currentSection;
              return (
                <li key={destination.section}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent focus-visible:ring-3 focus-visible:ring-ring/40',
                      active && 'after:bg-brand',
                      emphasisClasses(destination, active),
                    )}
                    href={destination.href}
                  >
                    {t(destination.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                // The accessible name has to contain the visible one, so when the
                // trigger reads "Expenses" the label leads with it.
                aria-label={
                  currentLabel ? t('moreLabelCurrent', { section: currentLabel }) : t('moreLabel')
                }
                className={cn(
                  'shrink-0',
                  currentLabel ? 'bg-secondary text-secondary-foreground' : undefined,
                )}
                size="sm"
                type="button"
                variant="ghost"
              />
            }
          >
            {/* Icon or name, never both — the row is tight at 375px. Off the core
                experiences the name always shows, because it is the only thing telling
                the traveller where they are. */}
            {currentLabel ? null : <Ellipsis aria-hidden="true" data-icon="inline-start" />}
            <span className={currentLabel ? undefined : 'hidden sm:inline'}>
              {currentLabel ?? t('more')}
            </span>
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('supportingTools')}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {supporting.map((destination) => (
              <DropdownMenuLinkItem
                aria-current={destination.section === currentSection ? 'page' : undefined}
                key={destination.section}
                render={<Link href={destination.href} />}
              >
                {t(destination.labelKey)}
              </DropdownMenuLinkItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {description ? (
        <p
          className={cn(
            'max-w-[var(--layout-reading)] text-sm leading-[1.55] text-pretty text-muted-foreground',
            // Standing guidance is worth its rows on a wide screen and worth
            // fewer than none on a phone, where it sits between the traveller
            // and their own plan.
            density === 'compact' && 'hidden sm:block',
          )}
        >
          {description}
        </p>
      ) : null}
    </header>
  );
}
