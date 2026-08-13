'use client';

import { ChevronRight, HardDrive } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { listTripSnapshots } from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';

type PreparedTrip = { id: string; name: string | null };

/**
 * The offline fallback is reached whenever an uncached page is requested, which
 * includes cases where the user does have trips available offline. Listing them
 * turns a dead end into a route back into their own cached data.
 */
export function OfflineAvailableTrips() {
  const t = useTranslations('offline');
  const [trips, setTrips] = useState<PreparedTrip[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { userId } = await getOfflineAuthContext();
        const snapshots = await listTripSnapshots(userId);
        if (!active) return;
        setTrips(
          snapshots
            .filter((snapshot) => snapshot.preparedAt)
            .map((snapshot) => ({
              id: snapshot.tripId,
              name: snapshot.trip?.name ?? snapshot.itinerary?.trip.name ?? null,
            })),
        );
      } catch {
        if (active) setTrips([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!trips.length) return null;

  return (
    <section aria-labelledby="offline-trips-heading" className="mx-auto mt-8 w-full max-w-md">
      <h2 className="text-sm font-semibold text-foreground" id="offline-trips-heading">
        {t('availableTitle')}
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('availableDescription')}</p>
      <ItemGroup className="mt-3">
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
    </section>
  );
}
