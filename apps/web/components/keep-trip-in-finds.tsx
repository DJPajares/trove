'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { useOnlineStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import type { PublicItinerary } from '@/lib/public-trip/api';
import { queryKeys } from '@/lib/query/keys';
import {
  fetchSavedTrips,
  removeTripFromFinds,
  SavedApiError,
  saveTripToFinds,
} from '@/lib/saved/api';
import { fetchTrips } from '@/lib/trips/api';
import * as Icons from '@/lib/icons';

/**
 * Keep a shared trip in Finds to read for ideas (PRD 8.4), beside "Use this
 * trip". Keeping it is a bookmark, not a copy: Finds lists it only while its
 * owner keeps it Public.
 *
 * A signed-out reader is sent to sign in and comes back with the trip kept,
 * which is what they asked for. The trip's owner is offered nothing here.
 */
export function KeepTripInFinds({
  isSignedIn,
  trip,
}: Readonly<{ isSignedIn: boolean; trip: PublicItinerary['trip'] }>) {
  const t = useTranslations('sharedTrip.keep');
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const keptAfterSignIn = useRef(false);

  const ownTrips = useQuery({
    enabled: isSignedIn,
    queryFn: () => fetchTrips(),
    queryKey: queryKeys.trips(),
  });
  const savedTrips = useQuery({
    enabled: isSignedIn,
    queryFn: fetchSavedTrips,
    queryKey: queryKeys.savedTrips(),
    refetchOnMount: 'always',
  });
  const isOwner = ownTrips.data?.trips.some((owned) => owned.id === trip.id) ?? false;
  const kept = savedTrips.data?.trips.some((entry) => entry.id === trip.id) ?? false;

  async function setKept(next: boolean) {
    setBusy(true);
    setFeedback(null);
    try {
      await (next ? saveTripToFinds(trip.id) : removeTripFromFinds(trip.id));
      await queryClient.invalidateQueries({ queryKey: queryKeys.savedTrips() });
      setFeedback(next ? t('savedFeedback') : t('removedFeedback'));
    } catch (error) {
      // Nothing reads as kept unless the server said so.
      setFeedback(error instanceof SavedApiError && error.status === 404 ? t('gone') : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  // Back from signing in to keep it: keep it, once, and tidy the address.
  useEffect(() => {
    if (!isSignedIn || keptAfterSignIn.current || searchParams.get('keep') !== '1') return;
    if (!savedTrips.isSuccess || !ownTrips.isSuccess) return;
    keptAfterSignIn.current = true;
    router.replace(pathname, { scroll: false });
    if (!kept && !isOwner && online) void setKept(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, savedTrips.isSuccess, ownTrips.isSuccess]);

  if (isOwner) return null;

  if (!isSignedIn) {
    const next = `/shared/${trip.id}?keep=1`;
    return (
      <Button
        nativeButton={false}
        render={<Link href={`/sign-in?next=${encodeURIComponent(next)}`} />}
        size="sm"
        variant="outline"
      >
        <Icons.Saved aria-hidden="true" data-icon="inline-start" />
        {t('signInAction')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        aria-pressed={kept}
        disabled={busy || !online || !savedTrips.isSuccess}
        onClick={() => void setKept(!kept)}
        size="sm"
        variant="outline"
      >
        <Icons.Saved
          aria-hidden="true"
          className={kept ? 'fill-current' : undefined}
          data-icon="inline-start"
        />
        {kept ? t('saved') : t('action')}
      </Button>
      <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
        {online ? feedback : t('offline')}
      </p>
    </div>
  );
}
