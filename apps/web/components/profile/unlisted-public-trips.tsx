'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useOnlineStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrips, listTripOnProfile } from '@/lib/trips/api';

/**
 * For the owner only, on their own public view: trips that are Public but not
 * listed, because they went Public before profiles listed trips (PRD 8.3).
 *
 * "Show on my profile" sits beside the line saying what listing shares, so
 * pressing it is the owner choosing listing under the current disclosure - what
 * switching the trip to Private and back used to stand for.
 */
export function UnlistedPublicTrips() {
  const t = useTranslations('publicTraveller.unlisted');
  const online = useOnlineStatus();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const trips = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  const unlisted = (trips.data?.trips ?? []).filter(
    (trip) => trip.visibility === 'public' && trip.listedOnProfile === false && !trip.archivedAt,
  );
  if (!unlisted.length) return null;

  async function list(tripId: string) {
    setBusyId(tripId);
    setFailed(false);
    try {
      await listTripOnProfile(tripId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trips() });
      // The listed trips come from the server page, so it is read again.
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section
      aria-labelledby="unlisted-public-trips"
      className="space-y-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold" id="unlisted-public-trips">
        {t('title', { count: unlisted.length })}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t('description', { count: unlisted.length })}
      </p>
      <ul className="divide-y divide-border-subtle">
        {unlisted.map((trip) => (
          <li className="flex items-center justify-between gap-3 py-2.5" key={trip.id}>
            <span className="min-w-0 truncate text-sm font-medium">{trip.name}</span>
            <Button
              disabled={!online || busyId !== null}
              onClick={() => void list(trip.id)}
              size="sm"
              variant="outline"
            >
              {busyId === trip.id ? t('listing') : t('action')}
            </Button>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm text-status-danger" role="status">
        {failed ? t('error') : null}
      </p>
    </section>
  );
}
