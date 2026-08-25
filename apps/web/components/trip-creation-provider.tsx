'use client';

import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { TripForm } from '@/components/trip-form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { Trip } from '@/lib/trips/api';

type TripCreationContextValue = {
  latestCreatedTrip: Trip | null;
  openCreateTrip: () => void;
};

type TripCreationProviderProps = {
  children: ReactNode;
  enabled: boolean;
};

const TripCreationContext = createContext<TripCreationContextValue | null>(null);
const disabledTripCreationContext: TripCreationContextValue = {
  latestCreatedTrip: null,
  openCreateTrip: () => undefined,
};

export function useTripCreation() {
  const context = useContext(TripCreationContext);
  if (!context) throw new Error('useTripCreation must be used within TripCreationProvider');
  return context;
}

/** One creation sheet follows the signed-in shell, so starting a trip never changes routes. */
export function TripCreationProvider({ children, enabled }: Readonly<TripCreationProviderProps>) {
  const t = useTranslations('trips');
  const [open, setOpen] = useState(false);
  const [latestCreatedTrip, setLatestCreatedTrip] = useState<Trip | null>(null);
  const openCreateTrip = useCallback(() => setOpen(true), []);
  const context = useMemo(
    () => (enabled ? { latestCreatedTrip, openCreateTrip } : disabledTripCreationContext),
    [enabled, latestCreatedTrip, openCreateTrip],
  );

  function handleSaved(trip: Trip) {
    setLatestCreatedTrip(trip);
    setOpen(false);
  }

  return (
    <TripCreationContext.Provider value={context}>
      {children}
      {enabled ? (
        <Sheet onOpenChange={setOpen} open={open}>
          <SheetContent
            className="w-full md:data-[side=right]:w-[min(36rem,calc(100%-0.5rem))]"
            closeLabel={t('close')}
          >
            <SheetHeader className="border-b">
              <SheetTitle>{t('createTitle')}</SheetTitle>
              <SheetDescription>{t('createDescription')}</SheetDescription>
            </SheetHeader>
            {open ? (
              <TripForm onCancel={() => setOpen(false)} onSaved={handleSaved} trip={null} />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </TripCreationContext.Provider>
  );
}
