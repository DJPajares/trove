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
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { tripSectionIcons } from '@/lib/icons';
import type { Trip } from '@/lib/trips/api';
import { supportingTripDestinations } from '@/lib/trips/navigation';

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
  movingDates,
  onDelete,
  onEdit,
  onMoveDates,
  onShare,
  onToggleReadiness,
  overview,
  readinessPending,
  trip,
}: Readonly<{
  movingDates: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDates: (days: number) => void;
  onShare: () => void;
  onToggleReadiness: () => void;
  overview: TripOverviewData | undefined;
  readinessPending: boolean;
  trip: Trip;
}>) {
  const t = useTranslations('trips');
  const hub = useTranslations('trips.hub');
  const share = useTranslations('trips.share');
  const offline = useTranslations('tripMode.offlineReady');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const supporting = supportingTripDestinations(trip.id);
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
        <Button
          aria-haspopup="dialog"
          className="rounded-full"
          onClick={() => setToolsOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t('tripTools')}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
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
            <DropdownMenuItem onClick={onEdit}>
              <Pencil aria-hidden="true" />
              {t('editTrip')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={movingDates}>
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
            <DropdownMenuItem onClick={onShare}>
              <Share2 aria-hidden="true" />
              {share('action')}
            </DropdownMenuItem>
            {/* Readiness is the traveller's to declare, and only while the plan
              is still the thing being worked on. */}
            {trip.lifecycle === 'planning' ? (
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
            <DropdownMenuItem onClick={() => setOfflineOpen(true)}>
              <CloudDownload aria-hidden="true" />
              {offline('title')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} variant="destructive">
              <Trash2 aria-hidden="true" />
              {t('deleteTrip')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Sheet onOpenChange={setToolsOpen} open={toolsOpen}>
        <SheetContent closeLabel={t('close')}>
          <SheetHeader>
            <SheetTitle>{t('tripTools')}</SheetTitle>
            <SheetDescription>{hub('toolsDescription')}</SheetDescription>
          </SheetHeader>
          <ul className="px-4 pb-4">
            {supporting.map((destination) => {
              const Icon = tripSectionIcons[destination.section];
              const section = destination.section as keyof typeof summary;
              return (
                <li className="border-b border-border-subtle last:border-b-0" key={section}>
                  <Link
                    className="group flex min-h-18 items-center gap-4 rounded-[var(--radius-md)] py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    href={destination.href}
                    onClick={() => setToolsOpen(false)}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-surface-tint text-brand"
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t(destination.labelKey)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {summary[section]}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>

      <Sheet onOpenChange={setOfflineOpen} open={offlineOpen}>
        <SheetContent closeLabel={t('close')}>
          <SheetHeader>
            <SheetTitle>{offline('title')}</SheetTitle>
            <SheetDescription>{offline('description')}</SheetDescription>
          </SheetHeader>
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
