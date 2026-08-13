'use client';

import { CloudDownload, Download, HardDrive, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Card } from '@/components/ui/card';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { prepareTripForOffline, removePreparedTrip } from '@/lib/offline/trip-preparation';
import {
  getOfflineTripReadiness,
  listOfflineReservationDocuments,
  listTripSnapshots,
  listUserMutations,
  OFFLINE_SYNC_EVENT,
  type OfflineReadinessState,
} from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';
import { useInstallPrompt } from '@/lib/pwa/install';

type PreparedTrip = {
  documentCount: number;
  name: string | null;
  readiness: OfflineReadinessState;
  tripId: string;
  unsyncedChanges: number;
};

type LoadState = 'error' | 'loading' | 'ready';

export function OfflineStorageSettings() {
  const t = useTranslations('offlineStorage');
  const online = useOnlineStatus();
  const { availability, install } = useInstallPrompt();
  const [trips, setTrips] = useState<PreparedTrip[]>([]);
  const [status, setStatus] = useState<LoadState>('loading');
  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<PreparedTrip | null>(null);
  const [actionError, setActionError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { userId } = await getOfflineAuthContext();
      const [snapshots, mutations] = await Promise.all([
        listTripSnapshots(userId),
        listUserMutations(userId),
      ]);
      const prepared = await Promise.all(
        snapshots.map(async (snapshot) => {
          const documents = await listOfflineReservationDocuments(userId, snapshot.tripId);
          return {
            documentCount: documents.length,
            name: snapshot.trip?.name ?? snapshot.itinerary?.trip.name ?? null,
            readiness: getOfflineTripReadiness(snapshot, documents).state,
            tripId: snapshot.tripId,
            unsyncedChanges: mutations.filter((mutation) => mutation.tripId === snapshot.tripId)
              .length,
          };
        }),
      );
      setTrips(prepared);
      setStatus('ready');
    } catch {
      setTrips([]);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(OFFLINE_SYNC_EVENT, refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_EVENT, refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  async function refreshTrip(tripId: string) {
    setActionError(false);
    setBusyTripId(tripId);
    try {
      await prepareTripForOffline(tripId);
    } catch {
      setActionError(true);
    } finally {
      setBusyTripId(null);
      await refresh();
    }
  }

  async function removeTrip(tripId: string) {
    setActionError(false);
    setBusyTripId(tripId);
    try {
      await removePreparedTrip(tripId);
      setRemoveTarget(null);
    } catch {
      setActionError(true);
    } finally {
      setBusyTripId(null);
      await refresh();
    }
  }

  return (
    <Card className="gap-0 py-0" id="offline-storage">
      <section aria-labelledby="offline-storage-heading" className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <HardDrive aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <h2
              className="text-lg leading-6 font-semibold tracking-tight"
              id="offline-storage-heading"
            >
              {t('title')}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        {actionError ? (
          <Alert className="mt-5" role="alert" variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{t('actionError')}</AlertDescription>
          </Alert>
        ) : null}

        {availability !== 'unavailable' ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t('installTitle')}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {availability === 'installed' ? t('installedDescription') : t('installDescription')}
              </p>
            </div>
            {availability === 'available' ? (
              <Button onClick={() => void install()} size="sm" variant="outline">
                <Download aria-hidden="true" data-icon="inline-start" />
                {t('install')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div aria-live="polite" className="mt-6 border-y border-border py-1">
          {status === 'loading' ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 2 }, (_, index) => (
                <div className="flex items-center gap-3" key={index}>
                  <Skeleton className="size-9 shrink-0 motion-reduce:animate-none" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {status === 'error' ? (
            <p className="py-4 text-sm leading-6 text-muted-foreground">{t('unavailable')}</p>
          ) : null}

          {status === 'ready' && !trips.length ? (
            <p className="py-4 text-sm leading-6 text-muted-foreground">{t('empty')}</p>
          ) : null}

          {status === 'ready' && trips.length ? (
            <ItemGroup className="py-1">
              {trips.map((trip) => (
                <Item key={trip.tripId} size="sm" variant="outline">
                  <ItemMedia className="text-muted-foreground" variant="icon">
                    <HardDrive aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{trip.name ?? t('untitledTrip')}</ItemTitle>
                    <ItemDescription>
                      {[
                        t(`readiness.${trip.readiness}`),
                        trip.documentCount
                          ? t('documentCount', { count: trip.documentCount })
                          : null,
                        trip.unsyncedChanges
                          ? t('unsyncedCount', { count: trip.unsyncedChanges })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ItemDescription>
                  </ItemContent>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      disabled={!online || busyTripId === trip.tripId}
                      onClick={() => void refreshTrip(trip.tripId)}
                      size="xs"
                      variant="outline"
                    >
                      {busyTripId === trip.tripId ? (
                        <RefreshCw
                          aria-hidden="true"
                          className="animate-spin motion-reduce:animate-none"
                          data-icon="inline-start"
                        />
                      ) : (
                        <CloudDownload aria-hidden="true" data-icon="inline-start" />
                      )}
                      {t('refresh')}
                    </Button>
                    <Button
                      disabled={busyTripId === trip.tripId || trip.unsyncedChanges > 0}
                      onClick={() => {
                        setActionError(false);
                        setRemoveTarget(trip);
                      }}
                      size="xs"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" data-icon="inline-start" />
                      {t('remove')}
                    </Button>
                  </div>
                </Item>
              ))}
            </ItemGroup>
          ) : null}
        </div>

        {!online ? (
          <p className="mt-4 text-xs leading-5 text-text-subtle">{t('offlineHint')}</p>
        ) : null}
        <p className="mt-4 text-xs leading-5 text-text-subtle">{t('cloudSafetyNote')}</p>
      </section>

      <AlertDialog
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        open={Boolean(removeTarget)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlert aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('removeDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyTripId)}
              onClick={() => removeTarget && void removeTrip(removeTarget.tripId)}
              variant="destructive"
            >
              {t('removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
