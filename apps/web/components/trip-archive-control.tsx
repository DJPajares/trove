'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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

/**
 * An archived trip, said quietly: one line under the trip's own navigation,
 * so the trip still reads as itself and Restore is a tap away without the
 * page turning into a status screen.
 */
export function TripArchivedNote({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('trips.archive');
  const [copied, setCopied] = useState(false);
  return (
    <aside
      aria-label={t('badge')}
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-lg)] border border-border-subtle bg-surface-sunken/60 py-2 pr-2 pl-3.5 text-sm"
    >
      <Archive aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-muted-foreground">
        <span className="font-semibold text-foreground">{t('badge')}</span>
        <span aria-hidden="true"> · </span>
        {t('readOnly')}
      </p>
      <div className="flex shrink-0 items-center gap-1">
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
        <TripArchiveControl trip={trip} />
      </div>
    </aside>
  );
}

/** The archived mark on a trip's cover, beside its lifecycle. */
export function TripArchivedBadge() {
  const t = useTranslations('trips.archive');
  return (
    <Badge className="gap-1 bg-neutral-950/58 text-white shadow-sm backdrop-blur-sm">
      <Archive aria-hidden="true" className="size-3" />
      {t('badge')}
    </Badge>
  );
}
