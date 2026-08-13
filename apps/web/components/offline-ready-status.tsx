'use client';

import {
  CheckCircle2,
  CloudDownload,
  Clock3,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import {
  getOfflineTripReadiness,
  getTripSyncSummary,
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
  ],
  lastPreparedAt: null,
  state: 'not_ready',
};

export function OfflineReadyStatus({ tripId }: Readonly<{ tripId: string }>) {
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
      const [snapshot, summary] = await Promise.all([
        readTripSnapshot(userId, tripId),
        getTripSyncSummary(userId, tripId),
      ]);
      setState({
        hasSnapshot: Boolean(snapshot),
        readiness: getOfflineTripReadiness(snapshot),
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

  return (
    <section aria-labelledby="offline-ready-heading" className="border-y border-border py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" id="offline-ready-heading">
            {t('title')}
          </h3>
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

      <dl className="mt-4 space-y-2 border-y border-border py-3">
        {state.readiness.categories.map((category) => (
          <div className="flex items-baseline justify-between gap-4" key={category.key}>
            <dt className="text-sm text-muted-foreground">{t(`categories.${category.key}`)}</dt>
            <dd className="shrink-0 text-xs font-medium text-foreground">
              {t(`categoryStates.${category.state}`)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs leading-5 text-text-subtle">
        {state.readiness.lastPreparedAt
          ? t('lastPrepared', {
              date: dateFormatter.format(new Date(state.readiness.lastPreparedAt)),
            })
          : t('notPrepared')}
      </p>
      <p className="mt-2 text-xs leading-5 text-text-subtle">{t('providerNote')}</p>

      {!online ? (
        <p className="mt-2 text-xs leading-5 text-text-subtle">{t('offlineHint')}</p>
      ) : null}
      {state.unsyncedChanges ? (
        <p className="mt-2 text-xs leading-5 text-text-subtle">
          {t('pendingChanges', { count: state.unsyncedChanges })}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
          {t('actionError')}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!online || isPreparing} onClick={() => void prepare()} size="sm">
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
        {state.hasSnapshot ? (
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
        ) : null}
      </div>

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
    </section>
  );
}
