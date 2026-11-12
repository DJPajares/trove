'use client';

import { ChevronRight, HardDrive, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { PageState } from '@/components/page-state';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { pickColdStartTrip } from '@/lib/offline/trip-pages';
import { listTripSnapshots } from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

type PreparedTrip = { id: string; name: string | null };

async function loadPreparedTrips() {
  // This screen is only served because a navigation failed, so it is offline
  // whatever `navigator.onLine` says.
  const { userId } = await getOfflineAuthContext({ assumeOffline: true });
  const snapshots = (await listTripSnapshots(userId)).filter((snapshot) => snapshot.preparedAt);
  return {
    coldStartTripId: pickColdStartTrip(snapshots.flatMap((snapshot) => snapshot.trip ?? [])),
    trips: snapshots.map((snapshot) => ({
      id: snapshot.tripId,
      name: snapshot.trip?.name ?? snapshot.itinerary?.trip.name ?? null,
    })),
  };
}

/**
 * The offline fallback, served for any page the device has no copy of -
 * including an installed Trove launched with no connection. When trips were
 * prepared, it leads with them rather than with the dead end.
 */
export function OfflineFallback() {
  const t = useTranslations('offline');
  const [trips, setTrips] = useState<PreparedTrip[] | null>(null);

  useEffect(() => {
    let active = true;
    void loadPreparedTrips()
      .then(({ coldStartTripId, trips: prepared }) => {
        if (!active) return;
        // A launch lands on Home; with one trip under way today, that trip is
        // where the traveller is headed. Any other page they asked for stays put.
        if (coldStartTripId && window.location.pathname === '/') {
          window.location.replace(`/trips/${coldStartTripId}/mode`);
          return;
        }
        setTrips(prepared);
      })
      .catch(() => {
        if (active) setTrips([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!trips) return null;

  const ready = trips.length > 0;

  return (
    <section
      aria-labelledby="offline-heading"
      className="grid min-h-[calc(100dvh-10rem)] content-center motion-safe:animate-in motion-safe:fade-in-0"
    >
      <PageState
        description={ready ? t('readyDescription') : t('description')}
        detail={
          ready ? (
            <ItemGroup className="w-full">
              {trips.map((trip) => (
                <Item
                  key={trip.id}
                  render={<Link href={`/trips/${trip.id}/mode`} />}
                  size="sm"
                  variant="outline"
                >
                  <ItemMedia className="text-muted-foreground" variant="icon">
                    <HardDrive aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{trip.name ?? t('untitledTrip')}</ItemTitle>
                  </ItemContent>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Item>
              ))}
            </ItemGroup>
          ) : undefined
        }
        eyebrow={t('eyebrow')}
        headingId="offline-heading"
        icon={<WifiOff aria-hidden="true" />}
        kind="offline"
        title={ready ? t('readyTitle') : t('title')}
      />
    </section>
  );
}
