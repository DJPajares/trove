'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { fetchProfile } from '@/lib/profile/api';
import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

/**
 * What a public trip's read-only link shows, and what it never does (PRD 8.2).
 * Shown wherever a trip can be made public - the Share dialog and the trip
 * form - so the traveller reads the same disclosure before either choice.
 */
export function TripShareDisclosure({
  className,
  id,
  trip,
}: Readonly<{ className?: string; id?: string; trip: Pick<Trip, 'basedOn'> | null }>) {
  const t = useTranslations('trips.share');
  // Already loaded by the preferences provider, so this reads the cache. The
  // name is what the link and every saved copy will say, so it is disclosed here.
  const profile = useQuery({ queryFn: fetchProfile, queryKey: queryKeys.profile() });
  const displayName = profile.data?.profile.displayName?.trim() || null;
  // A copy of someone else's trip keeps crediting them, not whoever shares it on.
  const creditName = trip?.basedOn ? trip.basedOn.creatorName : displayName;

  return (
    <div className={cn('flex flex-col gap-3 text-sm leading-5', className)} id={id}>
      <p className="font-medium">{t('sharedTitle')}</p>
      <ul className="list-disc space-y-2 pl-4 text-muted-foreground">
        <li>{t('sharedTrip')}</li>
        <li>{t('sharedDays')}</li>
        <li>{t('sharedStops')}</li>
        <li>
          {displayName ? (
            t('sharedName', { name: displayName })
          ) : (
            <>
              {t('sharedNameMissing')}{' '}
              <Link className="font-medium text-foreground underline" href="/settings">
                {t('addName')}
              </Link>
            </>
          )}
        </li>
      </ul>
      <p className="text-muted-foreground">
        {creditName ? t('copyCredit', { name: creditName }) : t('copyCreditAnonymous')}
      </p>
      <p className="text-muted-foreground">{t('privateDetails')}</p>
    </div>
  );
}
