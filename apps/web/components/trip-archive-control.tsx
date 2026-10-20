'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { setTripArchived, TripApiError, type Trip } from '@/lib/trips/api';
import { cacheSavedTrip } from '@/lib/trips/cache';
import { overviewLifecycle } from '@/lib/trips/overview';

export async function changeTripArchive(
  client: ReturnType<typeof useQueryClient>,
  tripId: string,
  archived: boolean,
) {
  const { trip } = await setTripArchived(tripId, archived);
  await client.cancelQueries({ predicate: (query) => query.queryKey[1] === tripId });
  cacheSavedTrip(client, trip);
  await Promise.all(
    ['trips', 'notifications', 'search'].map((root) =>
      client.invalidateQueries({ queryKey: [root] }),
    ),
  );
  await client.invalidateQueries({
    predicate: (query) => query.queryKey[1] === tripId,
    refetchType: 'none',
  });
  return trip;
}

export function TripArchiveControl({
  trip,
  menu = false,
}: Readonly<{ trip: Trip; menu?: boolean }>) {
  const t = useTranslations('trips.archive');
  const common = useTranslations('trips');
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = Boolean(trip.archivedAt);
  async function commit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await changeTripArchive(client, trip.id, !archived);
      setConfirming(false);
      if (!archived) router.replace(`/trips?archivedTrip=${trip.id}`);
      else if (pathname === '/trips/archived') router.replace(`/trips?restoredTrip=${trip.id}`);
    } catch (caught) {
      setError(
        t(
          caught instanceof TripApiError && caught.code === 'archive_pending'
            ? 'pendingError'
            : caught instanceof TripApiError && caught.code === 'archive_offline'
              ? 'offlineError'
              : 'error',
        ),
      );
    } finally {
      setPending(false);
    }
  }
  function start() {
    if (!archived && overviewLifecycle(trip, new Date()) !== 'completed') {
      setConfirming(true);
      return;
    }
    void commit();
  }
  const label = t(pending ? 'saving' : archived ? 'restore' : 'action');
  return (
    <>
      {menu ? (
        <DropdownMenuItem closeOnClick={false} disabled={pending} onClick={start}>
          {archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {label}
        </DropdownMenuItem>
      ) : (
        <Button disabled={pending} onClick={start} size="sm" variant="outline">
          {label}
        </Button>
      )}
      {error && !confirming ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {error} <Link href="/profile#offline-storage">{t('syncLink')}</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!pending) setConfirming(open);
        }}
      >
        <DialogContent closeLabel={common('close')}>
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
            <DialogDescription>{t('confirmDescription', { name: trip.name })}</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                {error} <Link href="/profile#offline-storage">{t('syncLink')}</Link>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={pending} onClick={() => setConfirming(false)} variant="outline">
              {common('cancel')}
            </Button>
            <Button disabled={pending} onClick={() => void commit()}>
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TripArchivedBanner({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.archive');
  const [copied, setCopied] = useState(false);
  return (
    <aside
      className="mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border-subtle bg-surface-tint p-4"
      role="status"
    >
      <div>
        <p className="font-semibold">{t('badge')}</p>
        <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
        <Link className="text-sm underline" href="/trips/archived">
          {t('view')}
        </Link>
      </div>
      <TripArchiveControl trip={trip} />
      {trip.visibility === 'public' ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/shared/${trip.id}`);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {t(copied ? 'copied' : 'copyShared')}
        </Button>
      ) : null}
    </aside>
  );
}
