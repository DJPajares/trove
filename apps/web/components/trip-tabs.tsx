'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import type { Trip } from '@/lib/trips/api';
import {
  tripSectionFromPathname,
  tripTabDestinations,
  type TripDestination,
} from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

function emphasisClasses(emphasis: TripDestination['emphasis'], active: boolean) {
  if (active) return 'text-foreground';
  if (emphasis === 'leading') return 'text-foreground hover:bg-surface-hover';
  if (emphasis === 'quiet') return 'text-text-subtle hover:bg-surface-hover hover:text-foreground';
  return 'text-muted-foreground hover:bg-surface-hover hover:text-foreground';
}

/**
 * The row that moves between the screens sharing a trip's cover: the trip's
 * overview and its planner. Trip Mode and Memories each open as an experience
 * of their own, with their own header and Exit, so neither is a tab here. The
 * overview is the way back from the planner, which used to have none.
 */
export function TripTabs({
  className,
  lifecycle,
  startDate,
  tripId,
}: Readonly<{
  className?: string;
  lifecycle: Trip['lifecycle'];
  startDate: string;
  tripId: string;
}>) {
  const t = useTranslations('trips');
  const pathname = usePathname();
  const overviewHref = `/trips/${tripId}`;
  const currentSection = tripSectionFromPathname(pathname, tripId);
  const tabs = [
    {
      active: pathname === overviewHref,
      emphasis: 'standard' as const,
      href: overviewHref,
      key: 'overview',
      label: t('overview'),
    },
    ...tripTabDestinations(tripId, lifecycle, startDate).map((destination) => ({
      active: destination.section === currentSection,
      emphasis: destination.emphasis,
      href: destination.href,
      key: destination.section,
      label: t(destination.labelKey),
    })),
  ];

  return (
    <nav aria-label={t('tripNavigation')} className={cn('min-w-0', className)}>
      {/* `overflow-x-auto` also clips vertically, which would cut the tabs'
        focus ring. The negative margin buys it room without moving the margin
        box, so each tab's active underline stays welded to the border below. */}
      <ul className="-m-1 flex items-center gap-1 overflow-x-auto p-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent focus-visible:ring-3 focus-visible:ring-ring/40',
                tab.active && 'font-semibold after:bg-brand',
                emphasisClasses(tab.emphasis, tab.active),
              )}
              href={tab.href}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
