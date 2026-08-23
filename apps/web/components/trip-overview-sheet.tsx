'use client';

import {
  ChevronRight,
  ClipboardCheck,
  Info,
  Pencil,
  ReceiptText,
  Users,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
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
import { primaryTripDestinations, supportingTripDestinations } from '@/lib/trips/navigation';

/** The tools' icons. Which tools there are, and their order, is the navigation contract's. */
const supportingIcons: Record<
  'expenses' | 'info' | 'reservations' | 'tasks',
  ComponentType<{ className?: string }>
> = {
  expenses: WalletCards,
  info: Info,
  reservations: ReceiptText,
  tasks: ClipboardCheck,
};

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

/** One fact about a trip. Local to this file: it has exactly one consumer. */
function OverviewFact({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div>
      <p className="text-[length:var(--text-metadata)] font-medium text-text-subtle">{label}</p>
      <p className="mt-1 text-sm break-words text-foreground">{value}</p>
    </div>
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
      <div className="space-y-3">
        <TripLifecycleBadge lifecycle={trip.lifecycle} />
        {/*
          Which actions a stage offers, in what order, and which one leads is the
          navigation contract's answer rather than this sheet's - the same one
          the trip's own screens use.
        */}
        <TripDestinationActions
          destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
          extra={
            <Button onClick={() => onEdit(trip)} variant="ghost">
              <Pencil aria-hidden="true" data-icon="inline-start" />
              {t('editTrip')}
            </Button>
          }
          labelOverrides={
            trip.lifecycle === 'completed'
              ? { memories: t(trip.memoryCount ? 'viewMemories' : 'addMemories') }
              : {
                  itinerary: t('continuePlanning'),
                  mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                }
          }
        />
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
      {/* Reference, not headline: the actions and the score above are what the
          traveller came for, so these read quieter than they used to. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <OverviewFact
          label={t('destinations')}
          value={
            trip.destinations.length
              ? trip.destinations.map((destination) => destination.name).join(', ')
              : t('destinationOpen')
          }
        />
        <OverviewFact
          label={t('travellers')}
          value={
            <span className="flex items-center gap-1.5">
              <Users aria-hidden="true" className="size-4" />
              {t('travellerCount', { count: trip.partySize })}
            </span>
          }
        />
        <OverviewFact
          label={t('planningReadiness')}
          value={t(`readinessState.${trip.planningReadiness}`)}
        />
        <OverviewFact
          label={t('startingLocation')}
          value={trip.startingLocation?.name ?? t('startingLocationUnavailable')}
        />
      </div>
      {trip.notes ? (
        <OverviewFact
          label={t('notes')}
          value={<span className="whitespace-pre-wrap">{trip.notes}</span>}
        />
      ) : null}
      <nav aria-label={t('tripTools')} className="border-t pt-5">
        <h2 className="text-base font-semibold">{t('tripTools')}</h2>
        <ItemGroup className="mt-3" variant="list">
          {supportingTripDestinations(trip.id).map((destination) => {
            const Icon = supportingIcons[destination.section as keyof typeof supportingIcons];

            return (
              <Item key={destination.section} render={<Link href={destination.href} />} size="sm">
                <ItemMedia variant="icon">
                  <Icon aria-hidden="true" className="text-brand" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(destination.labelKey)}</ItemTitle>
                </ItemContent>
                <ChevronRight aria-hidden="true" className="size-4 text-text-subtle" />
              </Item>
            );
          })}
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
        <EditorialSection
          actions={
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${trip.id}/info`} />}
              size="sm"
              variant="ghost"
            >
              {t('viewTripInfo')}
            </Button>
          }
          density="compact"
          description={t('pinnedTripInfo')}
          title={t('tripInfo')}
          treatment="ruled"
        >
          <div className="space-y-3">
            {tripInfo.map((entry) => (
              <OverviewFact key={entry.id} label={entry.label} value={entry.value} />
            ))}
          </div>
        </EditorialSection>
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
