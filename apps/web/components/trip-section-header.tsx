'use client';

import { ArrowLeft, ChevronDown, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

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
import { fetchTrip, type Trip } from '@/lib/trips/api';
import {
  primaryTripDestinations,
  supportingTripDestinations,
  tripSectionLabelKey,
  type TripDestination,
  type TripSection,
} from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

export type { TripSection };

type TripSectionHeaderProps = {
  actions?: ReactNode;
  currentSection: TripSection;
  description?: string;
  tripId: string;
};

function emphasisClasses(destination: TripDestination, active: boolean) {
  if (active) return 'bg-secondary text-secondary-foreground';
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
  currentSection,
  description,
  tripId,
}: Readonly<TripSectionHeaderProps>) {
  const t = useTranslations('trips');
  const locale = useLocale();
  const [trip, setTrip] = useState<Trip | null>(null);

  useEffect(() => {
    let active = true;
    setTrip(null);
    void fetchTrip(tripId)
      .then((result) => {
        if (active) setTrip(result.trip);
      })
      // Navigation must never be the thing that breaks: without the trip the
      // header simply loses its name and dates.
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [tripId]);

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
    <header className="space-y-5" data-slot="trip-section-header">
      <Link
        className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        href="/trips"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('title')}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-[clamp(1.875rem,5vw,2.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-pretty text-foreground">
            {trip?.name ?? t('titleLoading')}
          </h1>
          {trip ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('dateRange', {
                endDate: formatDate(trip.endDate),
                startDate: formatDate(trip.startDate),
              })}
              {' · '}
              {t(`lifecycle.${trip.lifecycle}`)}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <nav aria-label={t('tripNavigation')} className="min-w-0">
          <ul className="flex items-center gap-1 overflow-x-auto">
            {primary.map((destination) => {
              const active = destination.section === currentSection;
              return (
                <li key={destination.section}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center whitespace-nowrap rounded-[var(--radius-md)] px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40',
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
        <p className="max-w-[62ch] text-sm leading-6 text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
    </header>
  );
}
