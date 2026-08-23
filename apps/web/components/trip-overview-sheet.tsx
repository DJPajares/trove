'use client';

import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Compass,
  Eye,
  Info,
  Pencil,
  ReceiptText,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { fetchTripInfo, type TripInfoEntry } from '@/lib/trip-info/api';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';

// Tools only. Memories is one of the three experiences the trip is built around and
// belongs with them, and the itinerary opens the Places collection itself — listing
// either here would make a core experience look like a utility.
const overviewTools = [
  { href: 'reservations', icon: ReceiptText, label: 'reservations' },
  { href: 'tasks', icon: ClipboardCheck, label: 'tasks' },
  { href: 'expenses', icon: WalletCards, label: 'expenses' },
  { href: 'info', icon: Info, label: 'tripInfo' },
] as const;

function TripOverviewPlanScore({
  revision,
  tripId,
}: Readonly<{ revision: string; tripId: string }>) {
  const planScoreTranslations = useTranslations('planScore');
  const planScore = useTripPlanScore(tripId, revision);
  const planScoreHidden =
    planScore.status === 'disabled' ||
    Boolean(planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));

  if (planScoreHidden || (!planScore.data && planScore.status !== 'error')) return null;

  return (
    <PlanScorePanel
      disabled={planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')}
      explanations={
        planScore.data?.explanations ?? {
          uncertainty: [],
          whatWorks: [],
          worthImproving: [],
        }
      }
      onRetry={planScore.retry}
      score={planScore.data?.score ?? null}
      scope="trip"
      status={planScore.status}
      title={planScoreTranslations('title')}
    />
  );
}

export type TripOverviewContentProps = {
  /** Editing opens a sheet rather than a route, so it cannot be a destination. */
  onEdit: (trip: Trip) => void;
  planScoreEnabled: boolean;
  trip: Trip;
};

/**
 * Everything a trip says about itself outside its own screens.
 *
 * This is deliberately separate from the sheet that currently frames it: the
 * trip is about to get a real route of its own, and when it does this body
 * moves there unchanged while only the wrapper is thrown away.
 */
export function TripOverviewContent({
  onEdit,
  planScoreEnabled,
  trip,
}: Readonly<TripOverviewContentProps>) {
  const t = useTranslations('trips');
  const experienceRatingTranslations = useTranslations('experienceRating');
  const [tripInfo, setTripInfo] = useState<TripInfoEntry[]>([]);
  const [tripInfoStatus, setTripInfoStatus] = useState<'error' | 'idle' | 'loading'>('idle');

  const tripId = trip.id;
  useEffect(() => {
    let active = true;
    setTripInfoStatus('loading');

    void fetchTripInfo(tripId)
      .then(({ entries }) => {
        if (!active) return;
        setTripInfo(entries.filter((entry) => entry.isPinned));
        setTripInfoStatus('idle');
      })
      .catch(() => {
        if (!active) return;
        setTripInfoStatus('error');
      });

    return () => {
      active = false;
    };
  }, [tripId]);

  return (
    <div className="space-y-6 overflow-y-auto p-5">
      <div className="flex flex-wrap gap-2">
        {trip.lifecycle === 'active' ? (
          <Button nativeButton={false} render={<Link href={`/trips/${trip.id}/mode`} />}>
            <Compass aria-hidden="true" data-icon="inline-start" />
            {t('openTripMode')}
          </Button>
        ) : null}
        {trip.lifecycle === 'planning' ? (
          <Button
            nativeButton={false}
            render={
              <Link href={`/trips/${trip.id}/mode?preview=1&date=${trip.startDate}&time=09%3A00`} />
            }
          >
            <Eye aria-hidden="true" data-icon="inline-start" />
            {t('previewTripMode')}
          </Button>
        ) : null}
        {trip.lifecycle === 'completed' ? (
          <Button nativeButton={false} render={<Link href={`/trips/${trip.id}/memories`} />}>
            <Sparkles aria-hidden="true" data-icon="inline-start" />
            {t(trip.memoryCount ? 'viewMemories' : 'addMemories')}
          </Button>
        ) : null}
        <Button
          nativeButton={false}
          render={<Link href={`/trips/${trip.id}/itinerary`} />}
          variant="outline"
        >
          <CalendarClock aria-hidden="true" data-icon="inline-start" />
          {t('continuePlanning')}
        </Button>
        <Button onClick={() => onEdit(trip)} variant="ghost">
          <Pencil aria-hidden="true" data-icon="inline-start" />
          {t('editTrip')}
        </Button>
      </div>
      {/*
        Plan Score judges the plan and only applies while there is still
        planning to do; Experience Rating is the traveller's own reflection
        afterwards. They never occupy this slot at the same time.
      */}
      {trip.lifecycle === 'completed' ? (
        trip.experienceRating === null ? null : (
          <ExperienceRatingSummary
            label={experienceRatingTranslations('summaryLabel')}
            rating={trip.experienceRating}
          />
        )
      ) : planScoreEnabled ? (
        <TripOverviewPlanScore revision={trip.updatedAt} tripId={trip.id} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium">{t('destinations')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {trip.destinations.length
              ? trip.destinations.map((destination) => destination.name).join(', ')
              : t('destinationOpen')}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">{t('travellers')}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users aria-hidden="true" className="size-4" />
            {t('travellerCount', { count: trip.partySize })}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">{t('planningReadiness')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`readinessState.${trip.planningReadiness}`)}
          </p>
        </div>
        <div>
          <p className="text-sm font-medium">{t('startingLocation')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {trip.startingLocation?.name ?? t('startingLocationUnavailable')}
          </p>
        </div>
      </div>
      {trip.notes ? (
        <div>
          <p className="text-sm font-medium">{t('notes')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{trip.notes}</p>
        </div>
      ) : null}
      <nav aria-label={t('tripTools')} className="border-t pt-5">
        <h2 className="text-base font-semibold">{t('tripTools')}</h2>
        <ItemGroup className="mt-3" variant="list">
          {overviewTools.map(({ href, icon: Icon, label }) => (
            <Item key={href} render={<Link href={`/trips/${trip.id}/${href}`} />} size="sm">
              <ItemMedia variant="icon">
                <Icon aria-hidden="true" className="text-brand" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t(label)}</ItemTitle>
              </ItemContent>
              <ChevronRight aria-hidden="true" className="size-4 text-text-subtle" />
            </Item>
          ))}
        </ItemGroup>
      </nav>
      {tripInfoStatus === 'loading' ? (
        <section aria-busy="true" aria-live="polite" className="space-y-2 border-t pt-5">
          <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
          <p className="text-sm text-muted-foreground">{t('tripInfoLoading')}</p>
        </section>
      ) : null}
      {tripInfoStatus === 'error' ? (
        <section className="border-t pt-5">
          <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('tripInfoUnavailable')}</p>
        </section>
      ) : null}
      {tripInfoStatus === 'idle' && tripInfo.length ? (
        <section className="space-y-3 border-t pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('pinnedTripInfo')}</p>
            </div>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${trip.id}/info`} />}
              size="sm"
              variant="ghost"
            >
              {t('viewTripInfo')}
            </Button>
          </div>
          <div className="space-y-3">
            {tripInfo.map((entry) => (
              <div className="space-y-1" key={entry.id}>
                <p className="text-sm font-medium">{entry.label}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {entry.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export type TripOverviewSheetProps = {
  onEdit: (trip: Trip) => void;
  onOpenChange: (open: boolean) => void;
  planScoreEnabled: boolean;
  /** `null` closes the sheet. */
  trip: Trip | null;
};

/** The side panel a trip currently opens in, until it has a route of its own. */
export function TripOverviewSheet({
  onEdit,
  onOpenChange,
  planScoreEnabled,
  trip,
}: Readonly<TripOverviewSheetProps>) {
  const t = useTranslations('trips');
  const locale = useLocale();

  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(trip)}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(42rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        {trip ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{trip.name}</SheetTitle>
              <SheetDescription>
                {t('dateRange', {
                  endDate: formatTripDate(trip.endDate, locale),
                  startDate: formatTripDate(trip.startDate, locale),
                })}
              </SheetDescription>
            </SheetHeader>
            <TripOverviewContent onEdit={onEdit} planScoreEnabled={planScoreEnabled} trip={trip} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
