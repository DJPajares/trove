import { CalendarClock, Compass, Eye, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentType, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  isEmphasisAtLeast,
  tripDestinationEmphasisVariant,
  type TripDestination,
  type TripSection,
} from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

/**
 * Trip Mode wears a different face before departure than during the trip, so
 * the icon follows the label rather than the route.
 */
const sectionIcons: Record<
  'itinerary' | 'memories' | 'mode' | 'preview',
  ComponentType<{
    className?: string;
  }>
> = {
  itinerary: CalendarClock,
  memories: Sparkles,
  mode: Compass,
  preview: Eye,
};

type TripDestinationActionsProps = {
  className?: string;
  destinations: TripDestination[];
  inverse?: boolean;
  /**
   * Actions that are not destinations - editing a trip opens a sheet rather
   * than a route, so it cannot come from the navigation contract.
   */
  extra?: ReactNode;
  /**
   * Surface-specific wording. The navigation contract names a place
   * ("Itinerary"); a focal card wants the verb ("Continue planning"). The
   * contract stays label-neutral and each surface keeps its own voice.
   */
  labelOverrides?: Partial<Record<TripSection, string>>;
  /**
   * How prominent a destination must be to appear. Defaults to `standard`,
   * which is the stage's own actions - what the traveller is actually doing
   * now. Navigation shows the whole set and hides nothing; this is not that.
   */
  minEmphasis?: 'quiet' | 'standard';
  size?: 'default' | 'sm';
};

type TripDestinationActionProps = {
  className?: string;
  destination: TripDestination;
  inverse?: boolean;
  labelOverride?: string;
  size?: 'default' | 'sm';
};

/**
 * One destination control. Keeping this separate from the collection lets a
 * focal surface arrange its actions by purpose without re-creating the route,
 * icon, label, or lifecycle-emphasis rules.
 */
export function TripDestinationAction({
  className,
  destination,
  inverse = false,
  labelOverride,
  size = 'default',
}: Readonly<TripDestinationActionProps>) {
  const t = useTranslations('trips');
  const Icon = sectionIcons[destination.labelKey as keyof typeof sectionIcons];

  return (
    <Button
      className={cn(
        inverse
          ? destination.emphasis === 'leading'
            ? 'border-white/20 shadow-lg shadow-black/15'
            : 'border-white/30 bg-white/12 text-white shadow-none backdrop-blur-md hover:border-white/45 hover:bg-white/20 hover:text-white dark:bg-white/12 dark:hover:bg-white/20'
          : undefined,
        className,
      )}
      nativeButton={false}
      render={<Link href={destination.href} />}
      size={size}
      variant={tripDestinationEmphasisVariant(destination.emphasis)}
    >
      {Icon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
      {labelOverride ?? t(destination.labelKey)}
    </Button>
  );
}

/**
 * The actions a trip offers at the stage it is in.
 *
 * Order and membership come from `primaryTripDestinations`, so every surface
 * that offers a trip's actions offers the same ones in the same order, and the
 * lifecycle rule stays in one tested place rather than being retyped per card.
 */
export function TripDestinationActions({
  className,
  destinations,
  extra,
  inverse = false,
  labelOverrides,
  minEmphasis = 'standard',
  size = 'default',
}: Readonly<TripDestinationActionsProps>) {
  const offered = destinations.filter((destination) =>
    isEmphasisAtLeast(destination.emphasis, minEmphasis),
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {offered.map((destination) => (
        <TripDestinationAction
          destination={destination}
          inverse={inverse}
          key={destination.section}
          labelOverride={labelOverrides?.[destination.section]}
          size={size}
        />
      ))}
      {extra}
    </div>
  );
}
