'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CopyPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import type { PublicItinerary } from '@/lib/public-trip/api';
import { queryKeys } from '@/lib/query/keys';
import { copySharedTrip, fetchTrips, TripApiError } from '@/lib/trips/api';
import { calendarDayDistance } from '@/lib/trips/lifecycle';

type SaveTripCopyProps = {
  isSignedIn: boolean;
  /**
   * The header action answers `?copy=1` after sign-in; the footer repeats the
   * offer at the end of the plan, and says nothing at all to the trip's owner.
   */
  placement?: 'footer' | 'header';
  trip: PublicItinerary['trip'];
};

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Who a copy will credit: a copy of a copy still names the first creator. */
export function copyCreditName(trip: PublicItinerary['trip']) {
  return trip.basedOn ? trip.basedOn.creatorName : (trip.ownerName ?? null);
}

/**
 * Save a copy of a shared trip (PRD 8.1).
 *
 * The one interactive part of the shared page, kept to its own small island so
 * the itinerary itself still ships no JavaScript. A signed-out reader is sent to
 * sign in and comes straight back with the sheet open; the trip's owner is
 * pointed at their own trip instead; offline, the action says why it waits.
 */
export function SaveTripCopy({
  isSignedIn,
  placement = 'header',
  trip,
}: Readonly<SaveTripCopyProps>) {
  const t = useTranslations('sharedTrip.copy');
  const page = useTranslations('sharedTrip');
  const autoOpen = placement === 'header';
  const searchParams = useSearchParams();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  // The traveller's own trips are usually already cached, so recognising their
  // own shared trip costs nothing; archived trips are not in this list.
  const ownTrips = useQuery({
    enabled: isSignedIn,
    queryFn: () => fetchTrips(),
    queryKey: queryKeys.trips(),
  });
  const isOwner = ownTrips.data?.trips.some((owned) => owned.id === trip.id) ?? false;

  useEffect(() => {
    if (autoOpen && isSignedIn && searchParams.get('copy') === '1') setOpen(true);
  }, [autoOpen, isSignedIn, searchParams]);

  if (isOwner) {
    if (placement === 'footer') return null;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('yours')}</p>
        <Button
          nativeButton={false}
          render={<Link href={`/trips/${trip.id}`} />}
          size="sm"
          variant="secondary"
        >
          {t('openYours')}
        </Button>
      </div>
    );
  }

  if (!isSignedIn) {
    const next = `/shared/${trip.id}?copy=1`;
    return (
      <Button
        nativeButton={false}
        render={<Link href={`/sign-in?next=${encodeURIComponent(next)}`} />}
        size="sm"
      >
        <CopyPlus aria-hidden="true" data-icon="inline-start" />
        {t('signInAction')}
      </Button>
    );
  }

  const action = (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!online} onClick={() => setOpen(true)} size="sm">
        <CopyPlus aria-hidden="true" data-icon="inline-start" />
        {t('action')}
      </Button>
      {online ? null : <p className="text-sm text-muted-foreground">{t('offline')}</p>}
      <SaveTripCopySheet onOpenChange={setOpen} open={open} trip={trip} />
    </div>
  );
  if (placement === 'header') return action;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xl)] border border-border-subtle px-4 py-4">
      <p className="text-sm text-muted-foreground">{page('footerCopyPrompt')}</p>
      {action}
    </footer>
  );
}

function SaveTripCopySheet({
  onOpenChange,
  open,
  trip,
}: Readonly<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
  trip: PublicItinerary['trip'];
}>) {
  const t = useTranslations('sharedTrip.copy');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const idPrefix = useId();
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalDays = calendarDayDistance(trip.startDate, trip.endDate) + 1;
  const endDate = startDate ? addDays(startDate, totalDays - 1) : null;
  const creditName = copyCreditName(trip);
  const endLabel = endDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        new Date(`${endDate}T00:00:00.000Z`),
      )
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !startDate) return;
    setSaving(true);
    setError(null);
    try {
      const { trip: copy } = await copySharedTrip(trip.id, { name: name.trim(), startDate });
      void queryClient.invalidateQueries({ queryKey: queryKeys.trips() });
      router.push(`/trips/${copy.id}`);
    } catch (caught) {
      // Nothing is shown as saved unless the server said so.
      setError(caught instanceof TripApiError && caught.status === 404 ? t('gone') : t('failed'));
      setSaving(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeading description={t('description')} title={t('title')} />
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-shadow-y p-5">
            <FieldGroup>
              {error ? (
                <Alert role="alert" variant="destructive">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-name`}>{t('name')}</FieldLabel>
                <Input
                  autoComplete="off"
                  id={`${idPrefix}-name`}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-start`}>{t('startDate')}</FieldLabel>
                <DatePicker
                  id={`${idPrefix}-start`}
                  label={t('startDate')}
                  onChange={setStartDate}
                  required
                  value={startDate}
                />
                {endLabel ? (
                  <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                    {t('summary', { count: totalDays, endDate: endLabel })}
                  </p>
                ) : null}
              </Field>
              <div className="flex flex-col gap-2 text-sm leading-5">
                <p className="font-medium">{t('includedTitle')}</p>
                <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
                  <li>{t('included')}</li>
                  <li>{t('excluded')}</li>
                </ul>
                <p className="text-muted-foreground">
                  {creditName ? t('credit', { name: creditName }) : t('creditAnonymous')}
                </p>
              </div>
            </FieldGroup>
          </div>
          <SheetFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
              {t('cancel')}
            </Button>
            <Button disabled={saving || !online || !name.trim() || !startDate} type="submit">
              {saving ? t('saving') : t('save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
