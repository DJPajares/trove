'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { changeTripArchive } from '@/components/trip-archive-control';

export function TripArchiveFeedback() {
  const id = useSearchParams().get('archivedTrip');
  const restored = useSearchParams().get('restoredTrip');
  const t = useTranslations('trips.archive');
  const client = useQueryClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!id && restored && /^[\da-f-]{36}$/i.test(restored))
    return (
      <div
        role="status"
        className="rounded-[var(--radius-lg)] border border-border-subtle bg-card p-4"
      >
        {t('restored')}{' '}
        <Link className="underline" href={`/trips/${restored}`}>
          {t('open')}
        </Link>
      </div>
    );
  if (!id || !/^[\da-f-]{36}$/i.test(id)) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-4"
      role="status"
    >
      <p>{t(failed ? 'error' : 'success')}</p>
      <Button
        disabled={pending}
        size="sm"
        variant="outline"
        onClick={async () => {
          setPending(true);
          try {
            await changeTripArchive(client, id, false);
            router.replace('/trips');
          } catch {
            setFailed(true);
          } finally {
            setPending(false);
          }
        }}
      >
        {t('undo')}
      </Button>
      <Link className="text-sm underline" href="/trips/archived">
        {t('view')}
      </Link>
    </div>
  );
}
