'use client';

import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useTripContext } from '@/components/trip-provider';
import type { TripPlacesDayContext } from '@/components/trip-places-drawer';
import { canReturnFromPlaces, tripPlacesDrawerHref } from '@/lib/trip-places/navigation';

const TripPlacesDrawer = dynamic(() =>
  import('@/components/trip-places-drawer').then((module) => module.TripPlacesDrawer),
);

type PlacesContextValue = {
  closePlaces: () => void;
  openPlaces: (event?: { currentTarget: EventTarget | null }) => void;
  registerDay: (pathname: string, day: TripPlacesDayContext | null) => void;
};

const PlacesContext = createContext<PlacesContextValue | null>(null);

/** One on-demand collection, above the screen that asked for it. */
export function TripPlacesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const trip = useTripContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get('places') === '1';
  const opener = useRef<HTMLElement | null>(null);
  const [mountedPath, setMountedPath] = useState<string | null>(null);
  const [planning, setPlanning] = useState<{
    pathname: string;
    day: TripPlacesDayContext | null;
  } | null>(null);

  useEffect(() => {
    if (open) setMountedPath(pathname);
  }, [open, pathname]);

  const openPlaces = useCallback((event?: { currentTarget: EventTarget | null }) => {
    const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (new URLSearchParams(window.location.search).get('places') === '1') return;
    opener.current =
      event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
    window.history.pushState(
      { trovePlacesReturnHref: tripPlacesDrawerHref(href, false) },
      '',
      tripPlacesDrawerHref(href, true),
    );
  }, []);

  const closePlaces = useCallback(() => {
    const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (new URLSearchParams(window.location.search).get('places') !== '1') return;
    if (canReturnFromPlaces(window.history.state, href)) window.history.back();
    else window.history.replaceState(null, '', tripPlacesDrawerHref(href, false));
  }, []);

  const registerDay = useCallback((path: string, day: TripPlacesDayContext | null) => {
    setPlanning({ pathname: path, day });
  }, []);
  const value = useMemo(
    () => ({ closePlaces, openPlaces, registerDay }),
    [closePlaces, openPlaces, registerDay],
  );

  return (
    <PlacesContext.Provider value={value}>
      {children}
      {trip?.status === 'ready' && (open || mountedPath === pathname) ? (
        <TripPlacesDrawer
          key={pathname}
          dayContext={planning?.pathname === pathname ? planning.day : null}
          finalFocus={() =>
            open
              ? false
              : opener.current?.isConnected
                ? opener.current
                : (Array.from(
                    document.querySelectorAll<HTMLElement>('[data-trip-places-trigger]'),
                  ).find((element) => element.getClientRects().length > 0) ?? true)
          }
          onOpenChange={(next) => (next ? openPlaces() : closePlaces())}
          onOpenChangeComplete={(next) => !next && !open && setMountedPath(null)}
          open={open}
          tripId={trip.tripId}
        />
      ) : null}
    </PlacesContext.Provider>
  );
}

export function useTripPlacesDrawer() {
  const context = useContext(PlacesContext);
  if (!context) throw new Error('Trip Places requires TripPlacesProvider');
  return context;
}

/** The active planner day supplies live callbacks and data, never a second collection. */
export function useRegisterTripPlacesDay(day: TripPlacesDayContext | null) {
  const { registerDay } = useTripPlacesDrawer();
  const pathname = usePathname();
  useEffect(() => {
    registerDay(pathname, day);
    return () => registerDay(pathname, null);
  }, [day, pathname, registerDay]);
}
