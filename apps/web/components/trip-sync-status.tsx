'use client';

import { CloudUpload, RotateCcw, TriangleAlert, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  listUserMutations,
  isOfflineApiReachable,
  OFFLINE_CONNECTIVITY_EVENT,
  OFFLINE_DATA_REFRESH_EVENT,
  OFFLINE_SYNC_EVENT,
  type OfflineMutation,
} from '@/lib/offline/trip-store';
import {
  discardOfflineMutation,
  getOfflineAuthContext,
  retryOfflineMutation,
  syncOfflineMutations,
} from '@/lib/offline/trip-sync';

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    return () => {
      window.removeEventListener('offline', update);
      window.removeEventListener('online', update);
    };
  }, []);

  return online;
}

export function useOfflineDataRefreshKey() {
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshKey((current) => current + 1);
    window.addEventListener(OFFLINE_DATA_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_DATA_REFRESH_EVENT, refresh);
  }, []);

  return refreshKey;
}

export function TripSyncStatus({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.sync');
  const online = useOnlineStatus();
  const [mutations, setMutations] = useState<OfflineMutation[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { userId } = await getOfflineAuthContext();
      setMutations(await listUserMutations(userId, tripId));
    } catch {
      setMutations([]);
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
    const update = () => {
      setApiAvailable(isOfflineApiReachable());
      void refresh();
    };
    update();
    window.addEventListener(OFFLINE_CONNECTIVITY_EVENT, update);
    window.addEventListener(OFFLINE_SYNC_EVENT, update);
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_EVENT, update);
      window.removeEventListener(OFFLINE_CONNECTIVITY_EVENT, update);
      window.removeEventListener('offline', update);
      window.removeEventListener('online', update);
    };
  }, [refresh]);

  async function runAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
      window.dispatchEvent(new Event(OFFLINE_DATA_REFRESH_EVENT));
    } finally {
      setBusyId(null);
      await refresh();
    }
  }

  const pendingCount = mutations.filter((mutation) => mutation.state === 'pending').length;
  const attentionCount = mutations.length - pendingCount;
  const statusTitle = !online
    ? t('offlineTitle')
    : !apiAvailable
      ? t('savedTitle')
      : attentionCount
        ? t('attentionTitle', { count: attentionCount })
        : t('pendingTitle', { count: pendingCount });
  const statusDescription = !online
    ? t('offlineDescription')
    : !apiAvailable
      ? t('savedDescription')
      : attentionCount
        ? t('attentionDescription')
        : t('pendingDescription');
  const StatusIcon =
    !online || !apiAvailable ? WifiOff : attentionCount ? TriangleAlert : CloudUpload;

  if (online && apiAvailable && mutations.length === 0) return null;

  return (
    <>
      <Alert
        aria-live="polite"
        variant={!online || !apiAvailable ? 'warning' : attentionCount ? 'destructive' : 'default'}
      >
        <StatusIcon aria-hidden="true" />
        <AlertTitle>{statusTitle}</AlertTitle>
        <AlertDescription>{statusDescription}</AlertDescription>
        {mutations.length ? (
          <AlertAction>
            <Button onClick={() => setOpen(true)} size="xs" variant="ghost">
              {t('review')}
            </Button>
          </AlertAction>
        ) : null}
      </Alert>

      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent closeLabel={t('close')}>
          <SheetHeader>
            <SheetTitle>{t('title')}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            <ul aria-label={t('listLabel')} className="border-y border-border">
              {mutations.map((mutation) => (
                <li className="border-b border-border py-4 last:border-b-0" key={mutation.id}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
                      {mutation.state === 'conflict' || mutation.state === 'failed' ? (
                        <TriangleAlert aria-hidden="true" className="size-4" />
                      ) : (
                        <CloudUpload aria-hidden="true" className="size-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {t(`operations.${mutation.operation.kind}`)}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {t(
                          mutation.errorCode === 'itinerary_item_missing'
                            ? 'states.missing'
                            : `states.${mutation.state}`,
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {mutation.state === 'conflict' ? (
                      <>
                        <Button
                          disabled={busyId === mutation.id || !online}
                          onClick={() =>
                            void runAction(mutation.id, () => discardOfflineMutation(mutation.id))
                          }
                          size="sm"
                          variant="outline"
                        >
                          {t('useCloud')}
                        </Button>
                        {mutation.errorCode !== 'itinerary_item_missing' ? (
                          <Button
                            disabled={busyId === mutation.id || !online}
                            onClick={() =>
                              void runAction(mutation.id, () =>
                                retryOfflineMutation(mutation.id, true),
                              )
                            }
                            size="sm"
                          >
                            {t('keepMine')}
                          </Button>
                        ) : null}
                      </>
                    ) : mutation.state === 'failed' ? (
                      <Button
                        disabled={busyId === mutation.id || !online}
                        onClick={() =>
                          void runAction(mutation.id, () => retryOfflineMutation(mutation.id))
                        }
                        size="sm"
                      >
                        <RotateCcw
                          aria-hidden="true"
                          className={
                            busyId === mutation.id ? 'animate-spin motion-reduce:animate-none' : ''
                          }
                          data-icon="inline-start"
                        />
                        {t('retry')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {pendingCount && online ? (
            <div className="border-t border-border p-5">
              <Button
                className="w-full"
                onClick={() => void syncOfflineMutations().finally(refresh)}
                variant="outline"
              >
                {t('syncNow')}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
