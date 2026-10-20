'use client';

import type { TripOverviewData } from '@trove/types';
import {
  CalendarSync,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CloudDownload,
  Ellipsis,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useTripActions } from '@/components/trip-actions-provider';
import { TripArchiveControl } from '@/components/trip-archive-control';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { TripTabs } from '@/components/trip-tabs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeading, SheetTrigger } from '@/components/ui/sheet';
import { tripSectionIcons } from '@/lib/icons';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';
import {
  supportingTripDestinations,
  tripSectionFromPathname,
  tripSectionLabelKey,
} from '@/lib/trips/navigation';

const DATE_MOVES = [
  ['dayEarlier', -1],
  ['dayLater', 1],
  ['weekEarlier', -7],
  ['weekLater', 7],
] as const;

/**
 * The trip's own row: its two views, its tools, and the things done to the
 * trip itself. Tools and actions are kept apart - a tool is somewhere to go,
 * an action changes the trip - and neither is a grid of shortcuts on the page.
 */
export function TripHubBar({
  overview,
  trip,
}: Readonly<{
  overview: TripOverviewData | undefined;
  trip: Trip;
}>) {
  const {
    movingDates,
    onDelete,
    onEdit,
    onMoveDates,
    onShare,
    onToggleReadiness,
    readinessPending,
  } = useTripActions();
  const pathname = usePathname();
  const currentSection = tripSectionFromPathname(pathname, trip.id);
  const t = useTranslations('trips');
  const hub = useTranslations('trips.hub');
  const share = useTranslations('trips.share');
  const offline = useTranslations('tripMode.offlineReady');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const supporting = supportingTripDestinations(trip.id);
  const currentLabel =
    currentSection && currentSection !== 'itinerary'
      ? t(tripSectionLabelKey(currentSection))
      : undefined;
  const nextTask = overview?.tasks.next;
  const summary = {
    expenses: hub('toolSummary.expenses'),
    info: overview?.pinnedInfo.length
      ? hub('toolSummary.infoPinned', { count: overview.pinnedInfo.length })
      : hub('toolSummary.info'),
    reservations: hub('toolSummary.reservations'),
    tasks:
      overview && nextTask
        ? hub('toolSummary.tasks', { count: overview.tasks.openCount, next: nextTask.label })
        : hub('toolSummary.tasksNone'),
  } as const;

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle">
      <TripTabs lifecycle={trip.lifecycle} startDate={trip.startDate} tripId={trip.id} />
      <div className="flex shrink-0 items-center gap-1">
        <Sheet onOpenChange={setToolsOpen} open={toolsOpen}>
          <SheetTrigger
            render={
              <Button
                aria-label={
                  currentLabel ? t('moreLabelCurrent', { section: currentLabel }) : t('tripTools')
                }
                className="rounded-full"
                size="sm"
                type="button"
                variant="outline"
              />
            }
          >
            {currentLabel ?? t('tripTools')}
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </SheetTrigger>
          <SheetContent closeLabel={t('close')}>
            <SheetHeading title={t('tripTools')} description={hub('toolsDescription')} />
            <ul className="px-4 pb-4">
              {supporting.map((destination) => {
                const Icon = tripSectionIcons[destination.section];
                const section = destination.section as keyof typeof summary;
                const current = destination.section === currentSection;
                return (
                  <li className="border-b border-border-subtle py-1 last:border-b-0" key={section}>
                    <Link
                      className={cn(
                        'group flex min-h-18 items-center gap-4 rounded-[var(--radius-lg)] px-3 py-3 outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                        current
                          ? 'bg-primary/8 ring-1 ring-primary/20 ring-inset hover:bg-primary/12'
                          : 'hover:bg-surface-hover',
                      )}
                      aria-current={current ? 'page' : undefined}
                      href={destination.href}
                      onClick={() => setToolsOpen(false)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-11 shrink-0 place-items-center rounded-[var(--radius-lg)]',
                          current
                            ? 'bg-primary text-primary-foreground shadow-[var(--shadow-control)]'
                            : 'bg-surface-tint text-brand',
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block font-semibold', current && 'text-brand')}>
                          {t(destination.labelKey)}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {summary[section]}
                        </span>
                      </span>
                      {current ? (
                        <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-brand" />
                      ) : (
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SheetContent>
        </Sheet>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={t('tripActions')}
                className="shrink-0"
                size="icon"
                type="button"
                variant="ghost"
              />
            }
          >
            {/* The menu closes the moment a date is chosen, so without this the
              only sign the trip is moving would be the trip changing later. */}
            {movingDates ? (
              <RefreshCw aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Ellipsis aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56" sideOffset={8}>
            <DropdownMenuItem disabled={Boolean(trip.archivedAt)} onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t('editTrip')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={movingDates || Boolean(trip.archivedAt)}>
                <CalendarSync aria-hidden="true" />
                {t('moveDates.action')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DATE_MOVES.map(([key, days]) => (
                  <DropdownMenuItem key={key} onClick={() => onMoveDates(days)}>
                    {t(`moveDates.${key}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={Boolean(trip.archivedAt)} onClick={onShare}>
              <Share2 aria-hidden="true" />
              {share('action')}
            </DropdownMenuItem>
            {/* Readiness is the traveller's to declare, and only while the plan
              is still the thing being worked on. */}
            {trip.lifecycle === 'planning' && !trip.archivedAt ? (
              <DropdownMenuItem disabled={readinessPending} onClick={onToggleReadiness}>
                {trip.planningReadiness === 'ready' ? (
                  <RotateCcw aria-hidden="true" />
                ) : (
                  <CircleCheck aria-hidden="true" />
                )}
                {t(trip.planningReadiness === 'ready' ? 'markInProgress' : 'markReady')}
              </DropdownMenuItem>
            ) : null}
            {/* Keeping a copy on this device is something done to the trip, not
              a section of it, so it lives here rather than on the page. */}
            <DropdownMenuItem
              disabled={Boolean(trip.archivedAt)}
              onClick={() => setOfflineOpen(true)}
            >
              <CloudDownload aria-hidden="true" />
              {offline('title')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <TripArchiveControl trip={trip} menu />
            <DropdownMenuItem onClick={onDelete} variant="destructive">
              <Trash2 aria-hidden="true" />
              {t('deleteTrip')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Sheet onOpenChange={setOfflineOpen} open={offlineOpen}>
        <SheetContent closeLabel={t('close')}>
          <SheetHeading title={offline('title')} description={offline('description')} />
          {/* The status draws its own top rule for the page it used to sit on;
            under a sheet header that rule would be a second one. */}
          <div className="px-4 pb-6 [&>section]:border-t-0 [&>section]:pt-0">
            {offlineOpen ? (
              <OfflineReadyStatus headingLevel={3} tripId={trip.id} variant="compact" />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
