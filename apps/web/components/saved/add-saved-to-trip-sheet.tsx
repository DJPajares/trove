'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';

import { localToday } from '@/components/saved/saved-ready-for-trip';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { queryKeys } from '@/lib/query/keys';
import type { SavedPlace } from '@/lib/saved/api';
import { tripsForSavedPlace } from '@/lib/saved/collection-view';
import { addTripPlace } from '@/lib/trip-places/api';
import { fetchTrips } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

/**
 * Moves a saved place from inspiration into a plan. It joins the chosen trip's
 * places, not a day, and Saved is left as it was (PRD 14.2). The trip it sits
 * near is offered first, because that is almost always the one meant.
 */
export function AddSavedToTripSheet({
  name,
  onOpenChange,
  savedPlace,
}: Readonly<{
  name: string;
  onOpenChange: (open: boolean) => void;
  savedPlace: SavedPlace | null;
}>) {
  const t = useTranslations('saved.addToTrip');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const trips = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const options = useMemo(
    () => tripsForSavedPlace(savedPlace?.place.location, trips.data?.trips ?? [], localToday()),
    [savedPlace, trips.data],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const [status, setStatus] = useState<'added' | 'error' | 'idle' | 'saving'>('idle');
  const selectedId = chosen ?? options[0]?.trip.id ?? null;
  const selected = options.find((option) => option.trip.id === selectedId)?.trip ?? null;
  const range = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

  function close(open: boolean) {
    onOpenChange(open);
    if (!open) {
      setChosen(null);
      setStatus('idle');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!savedPlace || !selected) return;
    setStatus('saving');
    try {
      await addTripPlace(selected.id, savedPlace.place.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tripPlaces(selected.id) });
      setStatus('added');
    } catch {
      setStatus('error');
    }
  }

  return (
    <Sheet onOpenChange={close} open={Boolean(savedPlace)}>
      <SheetContent className="gap-0" closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle>{t('title', { name })}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submit(event)}>
          <div className="flex-1 space-y-2 overflow-y-auto p-5">
            {status === 'added' && selected ? (
              <div className="space-y-3" role="status">
                <p className="font-semibold">{t('added', { trip: selected.name })}</p>
                <Button
                  nativeButton={false}
                  render={<Link href={`/trips/${selected.id}/itinerary?places=1`} />}
                  variant="outline"
                >
                  {t('openTripPlaces')}
                </Button>
              </div>
            ) : options.length ? (
              <fieldset className="space-y-2">
                <legend className="pb-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {t('chooseTrip')}
                </legend>
                {options.map(({ near, trip }) => (
                  <label
                    className={cn(
                      'flex min-h-16 cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] border bg-card px-4 py-3 transition-colors duration-[var(--motion-standard)]',
                      trip.id === selectedId
                        ? 'border-brand ring-1 ring-brand'
                        : 'border-border-subtle hover:border-border-strong',
                    )}
                    key={trip.id}
                  >
                    <input
                      checked={trip.id === selectedId}
                      className="size-5 accent-[var(--brand)]"
                      name="trip"
                      onChange={() => setChosen(trip.id)}
                      type="radio"
                      value={trip.id}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{trip.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {range.formatRange(
                          new Date(`${trip.startDate}T00:00:00`),
                          new Date(`${trip.endDate}T00:00:00`),
                        )}
                      </span>
                    </span>
                    {near ? (
                      <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {t('near')}
                      </span>
                    ) : null}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noTrips')}</p>
            )}
            {status === 'error' ? (
              <p className="text-sm text-destructive" role="alert">
                {t('error')}
              </p>
            ) : null}
          </div>
          <SheetFooter className="gap-2">
            <p className="text-[length:var(--text-metadata)] text-muted-foreground">{t('note')}</p>
            {status === 'added' ? (
              <Button onClick={() => close(false)} type="button" variant="outline">
                {t('done')}
              </Button>
            ) : (
              <Button disabled={!selected || status === 'saving'} type="submit">
                {status === 'saving'
                  ? t('adding')
                  : selected
                    ? t('submit', { trip: selected.name })
                    : t('submitNoTrip')}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
