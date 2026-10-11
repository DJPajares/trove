'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { queryKeys } from '@/lib/query/keys';
import type { SavedPlace } from '@/lib/saved/api';
import { nextTripForSaved } from '@/lib/saved/collection-view';
import { addTripPlace, fetchTripPlaces } from '@/lib/trip-places/api';
import { savedPlacesNearTrip } from '@/lib/trip-places/saved-near-trip';
import { fetchTrips } from '@/lib/trips/api';

/** Today as the traveller's own calendar date, the same shape trips store. */
export function localToday() {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

/**
 * The first thing Saved offers: saved places that fit the next trip, with the
 * way to bring them in. Adding puts them among that trip's places, never on a
 * day, and leaves Saved exactly as it was (PRD 14.2). Everything here is Trove's
 * own data, so it costs no provider request.
 */
export function SavedReadyForTrip({
  nameOf,
  saved,
}: Readonly<{ nameOf: (savedPlace: SavedPlace) => string; saved: readonly SavedPlace[] }>) {
  const t = useTranslations('saved.readyForTrip');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const trips = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const trip = useMemo(() => nextTripForSaved(trips.data?.trips ?? [], localToday()), [trips.data]);
  const tripPlaces = useQuery({
    enabled: Boolean(trip),
    queryFn: () => fetchTripPlaces(trip?.id ?? ''),
    queryKey: queryKeys.tripPlaces(trip?.id ?? ''),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);

  const tripPlaceIds = useMemo(
    () => new Set((tripPlaces.data?.tripPlaces ?? []).map((tripPlace) => tripPlace.place.id)),
    [tripPlaces.data],
  );
  const groups = useMemo(
    () =>
      trip && tripPlaces.data
        ? savedPlacesNearTrip({ destinations: trip.destinations, saved, tripPlaceIds })
        : [],
    [saved, trip, tripPlaceIds, tripPlaces.data],
  );
  const candidates = groups.flatMap((group) => group.places);
  const alreadyIn = saved.filter((entry) => tripPlaceIds.has(entry.place.id)).length;

  if (!trip || (!candidates.length && !added)) return null;

  const days = Math.round(
    (Date.parse(`${trip.startDate}T00:00:00`) - Date.parse(`${localToday()}T00:00:00`)) /
      86_400_000,
  );
  const when =
    days > 0
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
      : t('underway');
  const where = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    groups.map((group) => group.destinationName).slice(0, 2),
  );

  async function add(key: string, entries: readonly SavedPlace[]) {
    if (!trip) return;
    setBusy(key);
    setFailed(false);
    try {
      for (const entry of entries) await addTripPlace(trip.id, entry.place.id);
      if (entries.length === candidates.length) setAdded(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tripPlaces(trip.id) });
    }
  }

  return (
    <section
      aria-labelledby="saved-ready-title"
      className="space-y-4 rounded-[var(--radius-2xl)] bg-score-media-background p-5 text-score-media-foreground sm:p-6"
    >
      <div className="space-y-1">
        <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase">
          {trip.name} · {when}
        </p>
        <h2
          className="font-journal text-[1.75rem] leading-[1.08] font-normal text-balance"
          id="saved-ready-title"
        >
          {added
            ? t('addedTitle', { trip: trip.name })
            : t('title', { count: candidates.length, where })}
        </h2>
        {!added && alreadyIn ? (
          <p className="text-sm text-score-media-muted">{t('alreadyIn', { count: alreadyIn })}</p>
        ) : null}
        {failed ? (
          <p className="text-sm text-score-media-warning" role="alert">
            {t('error')}
          </p>
        ) : null}
      </div>

      {added ? (
        <Button
          className="h-11 rounded-full border-score-media-foreground/25 bg-transparent text-score-media-foreground hover:bg-score-media-foreground/10 hover:text-score-media-foreground"
          nativeButton={false}
          render={<Link href={`/trips/${trip.id}/itinerary?places=1`} />}
          variant="outline"
        >
          {t('openTripPlaces')}
        </Button>
      ) : (
        <Collapsible className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11 flex-1 rounded-full bg-score-media-brand text-score-media-background hover:bg-score-media-brand/90"
              disabled={busy !== null}
              onClick={() => void add('all', candidates)}
              type="button"
            >
              {busy === 'all' ? t('adding') : t('addAll', { count: candidates.length })}
            </Button>
            <CollapsibleTrigger className="group/review h-11 rounded-full border border-score-media-foreground/25 px-4 text-score-media-foreground hover:text-score-media-foreground">
              {t('review')}
              <ChevronDown
                aria-hidden="true"
                className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]/review:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
          </div>
          <CollapsiblePanel>
            <ul className="divide-y divide-score-media-foreground/12">
              {candidates.map((entry) => (
                <li className="flex min-h-12 items-center justify-between gap-3" key={entry.id}>
                  <span className="min-w-0 truncate text-sm">{nameOf(entry)}</span>
                  <Button
                    aria-label={t('addOne', { name: nameOf(entry), trip: trip.name })}
                    className="rounded-full text-score-media-foreground hover:bg-score-media-foreground/10 hover:text-score-media-foreground"
                    disabled={busy !== null}
                    onClick={() => void add(entry.id, [entry])}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsiblePanel>
          <p className="text-[length:var(--text-metadata)] text-score-media-muted">{t('note')}</p>
        </Collapsible>
      )}
    </section>
  );
}
