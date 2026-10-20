'use client';

import { CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import {
  BookingReferenceCopy,
  ReservationCard,
  ReservationTypeTile,
  useReservationWhenLine,
} from '@/components/reservations/reservation-card';
import {
  ReservationEditorSheet,
  type ReservationEditor,
} from '@/components/reservations/reservation-editor-sheet';
import { TripSectionHeader } from '@/components/trip-section-header';
import { useTripContext } from '@/components/trip-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  deleteReservation,
  fetchReservations,
  type Reservation,
  type ReservationType,
} from '@/lib/reservations/api';
import {
  groupReservationsByDay,
  nextReservation,
  reservationWhen,
  stayNightsCovered,
} from '@/lib/reservations/view';
import { getLocalDate } from '@/lib/trips/lifecycle';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { invalidateTripQueries, PLAN_SCORE_INPUT_QUERY_ROOTS } from '@/lib/query/trip-invalidation';
import * as Icons from '@/lib/icons';

/** The bookings most trips start with, offered as a first step. */
const QUICK_START: readonly ReservationType[] = [
  'flight',
  'accommodation',
  'train',
  'restaurant',
  'attraction',
];

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * A trip's bookings, read the way the trip is: what is next, then day by day.
 * Each card carries what is asked for at a desk - when, where, and the
 * reference - and opens the booking to change it.
 */
export function ReservationsManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('reservations');
  const locale = useLocale();
  const { preferredCurrency } = usePreferences();
  const tripContext = useTripContext();
  const tripTimeZone = tripContext?.trip?.referenceTimeZone ?? deviceTimeZone();
  const queryClient = useQueryClient();
  const { data, refresh, status } = useTripResource(queryKeys.reservations(tripId), () =>
    fetchReservations(tripId),
  );
  const whenLine = useReservationWhenLine();
  /**
   * A reservation decides a day's fixed commitments and whether the item it is
   * attached to is anchored, both of which the Plan Score reads. A stay also
   * decides where each of its days starts and ends - the Stay the itinerary
   * shows at the top of the day and draws its first and last legs from - so the
   * itinerary is read again too. Its documents decide none of it, so only the
   * reservation itself clears these.
   */
  const refreshWithPlanScore = async () => {
    await refresh();
    await invalidateTripQueries(queryClient, tripId, [
      ...PLAN_SCORE_INPUT_QUERY_ROOTS,
      'itinerary',
      'itinerary-timing',
      'gap-suggestions',
      'rain-alternatives',
    ]);
  };
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ReservationEditor>({ mode: 'closed' });
  const [reservationToDelete, setReservationToDelete] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = (type: ReservationType | null = null) => setEditor({ mode: 'create', type });
  const openEdit = (reservation: Reservation) => setEditor({ mode: 'edit', reservation });

  // The Plan Score links straight to a booking (`?reservation=<id>`); open it
  // once, then drop the parameter so Back does not reopen it.
  const scoreParams = useSearchParams();
  const scorePath = usePathname();
  const handledScoreReservation = useRef<string | null>(null);
  const requestedReservation = scoreParams.get('reservation');
  useEffect(() => {
    if (!requestedReservation) {
      handledScoreReservation.current = null;
      return;
    }
    if (!data || handledScoreReservation.current === requestedReservation) return;
    handledScoreReservation.current = requestedReservation;
    const reservation = data.reservations.find((row) => row.id === requestedReservation);
    if (reservation) openEdit(reservation);
    const params = new URLSearchParams(scoreParams.toString());
    params.delete('reservation');
    window.history.replaceState(null, '', `${scorePath}${params.size ? `?${params}` : ''}`);
  }, [requestedReservation, data]);

  const groups = useMemo(
    () => (data ? groupReservationsByDay(data.reservations, data.days) : []),
    [data],
  );
  const now = new Date();
  const today = getLocalDate(now, tripTimeZone);
  const nowTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone: tripTimeZone,
  }).format(now);
  const next = data ? nextReservation(data.reservations, today, nowTime) : null;
  const nights = data ? stayNightsCovered(data.reservations, data.days) : null;
  const hasStay = data?.reservations.some((reservation) => reservation.type === 'accommodation');
  const dayFormat = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  });
  const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00.000Z`));

  async function handleDelete() {
    if (!reservationToDelete) return;
    setDeleting(true);
    try {
      await deleteReservation(tripId, reservationToDelete.id);
      setReservationToDelete(null);
      setEditor({ mode: 'closed' });
      await refreshWithPlanScore();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  if (status === 'loading') {
    return <PageState kind="loading" loadingShape="list" title={t('loading')} />;
  }
  if (status === 'error' || !data) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const nextWhen = next ? reservationWhen(next) : null;
  const nextLine = next ? whenLine(next) : null;

  return (
    <section className="space-y-7">
      <TripSectionHeader
        description={t('description')}
        primaryAction={{ label: t('addReservation'), onSelect: () => openCreate() }}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {data.reservations.length === 0 ? (
        <section
          aria-labelledby="reservations-empty"
          className="space-y-5 rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-6 text-center shadow-[var(--shadow-surface)] sm:p-8"
        >
          <span
            aria-hidden="true"
            className="mx-auto grid size-12 place-items-center rounded-[var(--radius-lg)] bg-secondary text-secondary-foreground"
          >
            <Icons.Reservations className="size-6" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold" id="reservations-empty">
              {t('emptyTitle')}
            </h2>
            <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
              {t('emptyDescription')}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {QUICK_START.map((type) => (
              <Button
                className="h-11 rounded-full pr-4 pl-1.5"
                key={type}
                onClick={() => openCreate(type)}
                type="button"
                variant="outline"
              >
                <ReservationTypeTile className="size-8 [&_svg]:size-4" type={type} />
                {t(`types.${type}`)}
              </Button>
            ))}
          </div>
          <Button className="h-11 px-2 text-brand" onClick={() => openCreate()} variant="ghost">
            {t('addSomethingElse')}
          </Button>
        </section>
      ) : (
        <>
          {/* With one booking the card below already is the next one. */}
          {next && nextWhen?.date && data.reservations.length > 1 ? (
            <section
              aria-labelledby="reservations-next"
              className="space-y-3 rounded-[var(--radius-2xl)] bg-score-media-background p-4 text-score-media-foreground sm:p-5"
            >
              <p
                className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase"
                id="reservations-next"
              >
                {nextWhen.date === today ? t('nextToday') : t('nextUp')}
              </p>
              <div className="flex items-start gap-3">
                <ReservationTypeTile
                  className="bg-score-media-foreground/10 text-score-media-brand"
                  type={next.type}
                />
                <div className="min-w-0 flex-1">
                  <button
                    className="text-left text-lg leading-snug font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-score-media-foreground/50"
                    onClick={() => openEdit(next)}
                    type="button"
                  >
                    {next.title}
                  </button>
                  <p className="text-sm text-score-media-muted tabular-nums">
                    {[nextWhen.date === today ? null : formatDay(nextWhen.date), nextLine]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              {next.bookingReference ? (
                <BookingReferenceCopy reference={next.bookingReference} tone="dark" />
              ) : null}
            </section>
          ) : null}

          {hasStay && nights ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icons.DailyBase
                aria-hidden="true"
                className="size-4 shrink-0 text-secondary-foreground"
              />
              {t('staysCovered', { covered: nights.covered, total: nights.total })}
            </p>
          ) : null}

          <div className="space-y-8">
            {groups.map((group) => (
              <section
                aria-labelledby={`reservations-${group.key}`}
                className="space-y-3"
                key={group.key}
              >
                <h2
                  className="flex items-center gap-3 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                  id={`reservations-${group.key}`}
                >
                  {group.kind === 'day'
                    ? t('dayHeading', { date: formatDay(group.date), number: group.dayNumber })
                    : t(`groups.${group.kind}`)}
                  <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {group.items.map((reservation) => (
                    <li key={reservation.id}>
                      <ReservationCard
                        onOpen={() => openEdit(reservation)}
                        reservation={reservation}
                        showDate={group.kind === 'before' || group.kind === 'after'}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <ReservationEditorSheet
        data={data}
        defaultTimeZone={tripTimeZone}
        editor={editor}
        onClose={() => setEditor({ mode: 'closed' })}
        onDelete={setReservationToDelete}
        onDocumentsChanged={refresh}
        onSaved={refreshWithPlanScore}
        preferredCurrency={preferredCurrency}
        tripId={tripId}
      />

      <AlertDialog
        onOpenChange={(open) => !open && setReservationToDelete(null)}
        open={Boolean(reservationToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { title: reservationToDelete?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteReservation')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
