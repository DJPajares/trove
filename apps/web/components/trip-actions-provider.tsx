'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { useTripCreation } from '@/components/trip-creation-provider';
import { TripForm } from '@/components/trip-form';
import { useTripContext } from '@/components/trip-provider';
import { TripShareDialog } from '@/components/trip-share-dialog';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ITINERARY_EDIT_QUERY_ROOTS, invalidateTripQueries } from '@/lib/query/trip-invalidation';
import { deleteTripAndClearCaches, tripEditMovesPlan } from '@/lib/trips/actions';
import type { Trip } from '@/lib/trips/api';
import { useTripDateMove } from '@/lib/trips/use-trip-date-move';
import { useTripReadiness } from '@/lib/trips/use-trip-readiness';

type TripActions = {
  movingDates: boolean;
  readinessPending: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDates: (days: number) => void;
  onShare: () => void;
  onToggleReadiness: () => void;
  feedback: ReactNode;
};

const TripActionsContext = createContext<TripActions | null>(null);

export function useTripActions() {
  const actions = useContext(TripActionsContext);
  if (!actions) throw new Error('Trip actions require TripActionsProvider');
  return actions;
}

/** The feedback stays beside the screen; dialogs are owned once by its provider. */
export function TripActionFeedback() {
  return useTripActions().feedback;
}

export function TripActionsProvider({
  children,
  trip,
}: Readonly<{ children: ReactNode; trip: Trip }>) {
  const t = useTranslations('trips');
  const router = useRouter();
  const queryClient = useQueryClient();
  const tripContext = useTripContext();
  const { forgetCreatedTrip } = useTripCreation();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const readiness = useTripReadiness();
  const dateMove = useTripDateMove();
  const movingDates = dateMove.pendingTripId === trip.id;

  function handleSaved(saved: Trip) {
    tripContext?.setTrip(saved);
    setEditing(false);
    if (tripEditMovesPlan(trip, saved)) {
      void invalidateTripQueries(queryClient, trip.id, ITINERARY_EDIT_QUERY_ROOTS);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTripAndClearCaches(queryClient, trip.id);
      forgetCreatedTrip(trip.id);
      setConfirmingDelete(false);
      setEditing(false);
      router.replace('/trips');
    } catch {
      setDeleteError(t('deleteError'));
      setDeleting(false);
    }
  }

  const feedback = (
    <>
      <div className="mt-6 space-y-3 empty:hidden">
        {dateMove.failedTripId === trip.id ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('moveDates.error')}</AlertDescription>
          </Alert>
        ) : null}
        {readiness.failedTripId === trip.id ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('readinessPrompt.error')}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {movingDates ? t('moveDates.moving') : ''}
      </span>
    </>
  );

  return (
    <TripActionsContext.Provider
      value={{
        feedback,
        movingDates,
        readinessPending: readiness.pendingTripId === trip.id,
        onDelete: () => {
          setDeleteError(null);
          setConfirmingDelete(true);
        },
        onEdit: () => setEditing(true),
        onMoveDates: (days) => void dateMove.moveTripDates(trip, days),
        onShare: () => setSharing(true),
        onToggleReadiness: () =>
          void readiness.setReadiness(
            trip,
            trip.planningReadiness === 'ready' ? 'in_progress' : 'ready',
          ),
      }}
    >
      {children}
      <TripShareDialog
        onOpenChange={setSharing}
        onTripChange={(updated) => tripContext?.setTrip(updated)}
        open={sharing}
        trip={trip}
      />
      <Sheet onOpenChange={setEditing} open={editing}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(44rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t('editTitle')}</SheetTitle>
            <SheetDescription>{t('editDescription')}</SheetDescription>
          </SheetHeader>
          {editing ? (
            <TripForm
              key={trip.id}
              onCancel={() => setEditing(false)}
              onDelete={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
              onSaved={handleSaved}
              trip={trip}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <AlertDialog
        onOpenChange={(open) => {
          if (!deleting) setConfirmingDelete(open);
        }}
        open={confirmingDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: trip.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteTrip')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TripActionsContext.Provider>
  );
}
