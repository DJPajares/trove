'use client';

import {
  CheckCircle2,
  ChevronDown,
  CloudDownload,
  Clock3,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { useOnlineStatus } from '@/components/trip-sync-status';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  getOfflineTripReadiness,
  getTripSyncSummary,
  listOfflineReservationDocuments,
  OFFLINE_SYNC_EVENT,
  readTripSnapshot,
  type OfflineTripReadiness,
} from '@/lib/offline/trip-store';
import { prepareTripForOffline, removePreparedTrip } from '@/lib/offline/trip-preparation';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

type ReadinessViewState = {
  hasSnapshot: boolean;
  readiness: OfflineTripReadiness;
  unsyncedChanges: number;
};

const emptyReadiness: OfflineTripReadiness = {
  categories: [
    { key: 'trip', state: 'not_ready' },
    { key: 'itinerary', state: 'not_ready' },
    { key: 'places', state: 'not_ready' },
    { key: 'reservations', state: 'not_ready' },
    { key: 'supporting', state: 'not_ready' },
    { key: 'expenses', state: 'not_ready' },
  ],
  lastPreparedAt: null,
  state: 'not_ready',
};

type OfflineReadyDetailsProps = {
  actionError: boolean;
  lastPreparedLabel: string;
  online: boolean;
  /** Compact carries these above the disclosure already; repeating is noise. */
  showActionError: boolean;
  showLastPrepared: boolean;
  state: ReadinessViewState;
};

/**
 * Everything about a trip's local copy beyond its headline state.
 *
 * Both variants render this same subtree - the compact one simply puts it
 * behind a disclosure. Sharing it is what stops Home and Trip Mode from
 * drifting into two different accounts of the same thing. It deliberately
 * holds neither the controls nor the state description: the two variants order
 * their buttons differently and place the description differently, and either
 * moving between them would be a change of behaviour hiding inside a change of
 * layout. The description in particular belongs to the live region, which must
 * not grow to cover the whole matrix - a readiness refresh should announce the
 * state, not read out every category.
 */
function OfflineReadyDetails({
  actionError,
  lastPreparedLabel,
  online,
  showActionError,
  showLastPrepared,
  state,
}: Readonly<OfflineReadyDetailsProps>) {
  const t = useTranslations('tripMode.offlineReady');

  return (
    <>
      <dl className="space-y-2 border-y border-border py-3">
        {state.readiness.categories.map((category) => (
          <div className="flex items-baseline justify-between gap-4" key={category.key}>
            <dt className="text-sm text-muted-foreground">{t(`categories.${category.key}`)}</dt>
            <dd className="shrink-0 text-xs font-medium text-foreground">
              {t(`categoryStates.${category.state}`)}
            </dd>
          </div>
        ))}
      </dl>

      {showLastPrepared ? (
        <p className="mt-3 text-xs leading-5 text-text-subtle">{lastPreparedLabel}</p>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-text-subtle">{t('providerNote')}</p>

      {!online ? (
        <p className="mt-2 text-xs leading-5 text-text-subtle">{t('offlineHint')}</p>
      ) : null}
      {state.unsyncedChanges ? (
        <p className="mt-2 text-xs leading-5 text-text-subtle">
          {t('pendingChanges', { count: state.unsyncedChanges })}
        </p>
      ) : null}
      {actionError && showActionError ? (
        <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
          {t('actionError')}
        </p>
      ) : null}
    </>
  );
}

export type OfflineReadyStatusProps = {
  headingId?: string;
  /**
   * How deep this block sits in the host route's outline. Separate from
   * `variant` on purpose: the compact layout happens to be a level down today,
   * but the two are not the same decision and conflating them is what made the
   * level unfixable from the outside.
   */
  headingLevel?: 2 | 3;
  tripId: string;
  /**
   * `detailed` is the full account, for a surface whose subject is the trip's
   * local copy. `compact` leads with the state and the one action and puts the
   * rest behind a disclosure.
   */
  variant?: 'compact' | 'detailed';
};

export function OfflineReadyStatus({
  headingId,
  headingLevel = 3,
  tripId,
  variant = 'detailed',
}: Readonly<OfflineReadyStatusProps>) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? generatedHeadingId;
  const t = useTranslations('tripMode.offlineReady');
  const online = useOnlineStatus();
  const [state, setState] = useState<ReadinessViewState>({
    hasSnapshot: false,
    readiness: emptyReadiness,
    unsyncedChanges: 0,
  });
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [actionError, setActionError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { userId } = await getOfflineAuthContext();
      const [snapshot, summary, documents] = await Promise.all([
        readTripSnapshot(userId, tripId),
        getTripSyncSummary(userId, tripId),
        listOfflineReservationDocuments(userId, tripId),
      ]);
      setState({
        hasSnapshot: Boolean(snapshot),
        readiness: getOfflineTripReadiness(snapshot, documents),
        unsyncedChanges: summary.pending + summary.failed + summary.conflict,
      });
    } catch {
      setState({ hasSnapshot: false, readiness: emptyReadiness, unsyncedChanges: 0 });
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
    window.addEventListener(OFFLINE_SYNC_EVENT, refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_EVENT, refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [],
  );

  const StatusIcon =
    state.readiness.state === 'ready'
      ? CheckCircle2
      : state.readiness.state === 'stale'
        ? Clock3
        : TriangleAlert;
  const statusTone =
    state.readiness.state === 'ready'
      ? 'text-status-success'
      : state.readiness.state === 'not_ready' || state.readiness.state === 'partial'
        ? 'text-muted-foreground'
        : 'text-status-warning';

  async function prepare() {
    setActionError(false);
    setIsPreparing(true);
    try {
      await prepareTripForOffline(tripId);
    } catch {
      setActionError(true);
    } finally {
      setIsPreparing(false);
      await refresh();
    }
  }

  async function remove() {
    setActionError(false);
    setIsRemoving(true);
    try {
      await removePreparedTrip(tripId);
      setRemoveOpen(false);
    } catch {
      setActionError(true);
    } finally {
      setIsRemoving(false);
      await refresh();
    }
  }

  const preparingLabel = state.readiness.lastPreparedAt ? t('refresh') : t('prepare');
  const lastPreparedLabel = state.readiness.lastPreparedAt
    ? t('lastPrepared', { date: dateFormatter.format(new Date(state.readiness.lastPreparedAt)) })
    : t('notPrepared');

  const isCompact = variant === 'compact';

  const prepareButton = (
    <Button
      disabled={!online || isPreparing}
      onClick={() => void prepare()}
      size="sm"
      variant={isCompact ? 'outline' : 'default'}
    >
      {isPreparing ? (
        <RefreshCw
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-start"
        />
      ) : (
        <CloudDownload aria-hidden="true" data-icon="inline-start" />
      )}
      {isPreparing ? t('preparing') : preparingLabel}
    </Button>
  );

  // Removing the local copy is destructive and never competes with preparing
  // one: it appears only once a copy exists, and never while changes are still
  // waiting to reach the server.
  const removeButton = state.hasSnapshot ? (
    <Button
      disabled={isPreparing || state.unsyncedChanges > 0}
      onClick={() => {
        setActionError(false);
        setRemoveOpen(true);
      }}
      size="sm"
      variant="ghost"
    >
      <Trash2 aria-hidden="true" data-icon="inline-start" />
      {t('remove')}
    </Button>
  ) : null;

  const details = (
    <OfflineReadyDetails
      actionError={actionError}
      lastPreparedLabel={lastPreparedLabel}
      online={online}
      showActionError={!isCompact}
      showLastPrepared={!isCompact}
      state={state}
    />
  );

  const removeDialog = (
    <AlertDialog onOpenChange={setRemoveOpen} open={removeOpen}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('removeDescription')}</AlertDialogDescription>
          {actionError ? (
            <p className="text-sm leading-6 text-destructive" role="alert">
              {t('actionError')}
            </p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRemoving}
            onClick={() => void remove()}
            variant="destructive"
          >
            {isRemoving ? t('removing') : t('removeConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (isCompact) {
    return (
      <section aria-labelledby={resolvedHeadingId} className="border-t border-border pt-4">
        <Heading className="sr-only" id={resolvedHeadingId}>
          {t('title')}
        </Heading>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            {/* The live region has to be something that stays on screen: an
                announcement made inside a closed panel is one nobody hears. */}
            <p
              aria-live="polite"
              className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground"
            >
              <StatusIcon aria-hidden="true" className={`size-4 shrink-0 ${statusTone}`} />
              {t('title')}
              <span className="font-normal text-muted-foreground">
                {t(`states.${state.readiness.state}`)}
              </span>
            </p>
            {/* Whether the copy is still current is the question this block
                exists to answer, so it stays out of the disclosure. */}
            <p className="mt-1 text-xs leading-5 text-text-subtle">{lastPreparedLabel}</p>
          </div>
          {prepareButton}
        </div>

        {/* A failure reachable only behind a closed panel is a silent one. */}
        {actionError ? (
          <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
            {t('actionError')}
          </p>
        ) : null}

        <Collapsible>
          <CollapsibleTrigger className="group mt-3">
            <ChevronDown
              aria-hidden="true"
              className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
            />
            <span className="group-data-[panel-open]:hidden">{t('showDetails')}</span>
            <span className="hidden group-data-[panel-open]:inline">{t('hideDetails')}</span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-3">
              <p className="mb-4 text-sm leading-6 text-muted-foreground">
                {t(`stateDescriptions.${state.readiness.state}`)}
              </p>
              {details}
              {removeButton ? <div className="mt-4">{removeButton}</div> : null}
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {removeDialog}
      </section>
    );
  }

  return (
    <section aria-labelledby={resolvedHeadingId} className="border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading className="text-base font-semibold" id={resolvedHeadingId}>
            {t('title')}
          </Heading>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('description')}</p>
        </div>
        <StatusIcon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${statusTone}`} />
      </div>

      <div aria-live="polite" className="mt-4">
        <p className="text-sm font-medium text-foreground">
          {t(`states.${state.readiness.state}`)}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {t(`stateDescriptions.${state.readiness.state}`)}
        </p>
      </div>

      <div className="mt-4">{details}</div>

      <div className="mt-4 flex flex-wrap gap-2">
        {prepareButton}
        {removeButton}
      </div>

      {removeDialog}
    </section>
  );
}
