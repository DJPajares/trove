'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { useTripModeClock } from '@/hooks/use-trip-mode-clock';
import {
  fetchItinerary,
  fetchTripModeContext,
  type Itinerary,
  type TripModeContext,
  type TripModeContextRequestOptions,
} from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { fetchReservations, type Reservation } from '@/lib/reservations/api';

type TripModeDataStatus = 'error' | 'loading' | 'ready';

type TripModeDataContextValue = {
  context: TripModeContext | null;
  itinerary: Itinerary | null;
  refresh: () => Promise<void>;
  reservations: Reservation[] | null;
  setItinerary: (update: (current: Itinerary | undefined) => Itinerary | undefined) => void;
  status: TripModeDataStatus;
};

type TripModeDataProviderProps = {
  children: ReactNode;
  contextOptions: (signal?: AbortSignal) => TripModeContextRequestOptions;
  isPreview: boolean;
  tripId: string;
};

const TripModeDataContext = createContext<TripModeDataContextValue | null>(null);

/**
 * The data every Trip Mode route reads.
 *
 * This provider lives in the mode layout's shell, so Now, Today, Map and Trip
 * all subscribe to the same query entries instead of buying the same answers
 * again when the traveller changes views.
 */
export function TripModeDataProvider({
  children,
  contextOptions,
  isPreview,
  tripId,
}: Readonly<TripModeDataProviderProps>) {
  const queryClient = useQueryClient();
  const contextQueryKey = useMemo(
    () => queryKeys.tripModeContext(tripId, contextOptions()),
    [contextOptions, tripId],
  );
  const contextQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchTripModeContext(tripId, contextOptions(signal)),
    queryKey: contextQueryKey,
  });
  const itineraryQuery = useTripResource(queryKeys.itinerary(tripId), () => fetchItinerary(tripId));
  const reservationsQuery = useTripResource(queryKeys.reservations(tripId), () =>
    fetchReservations(tripId),
  );

  const refreshContext = useCallback(async () => {
    await queryClient.invalidateQueries({ exact: true, queryKey: contextQueryKey });
  }, [contextQueryKey, queryClient]);
  const refresh = useCallback(async () => {
    await Promise.all([refreshContext(), itineraryQuery.refresh()]);
  }, [itineraryQuery.refresh, refreshContext]);

  const context = contextQuery.data ?? null;
  const clockRefreshKey = useTripModeClock({ context, enabled: !isPreview });
  const handledClockRefreshKey = useRef(0);

  useEffect(() => {
    if (!clockRefreshKey || handledClockRefreshKey.current === clockRefreshKey) return;
    handledClockRefreshKey.current = clockRefreshKey;
    void refreshContext();
  }, [clockRefreshKey, refreshContext]);

  const status: TripModeDataStatus =
    contextQuery.isPending || itineraryQuery.status === 'loading'
      ? 'loading'
      : contextQuery.error || itineraryQuery.status === 'error'
        ? 'error'
        : 'ready';
  const value = useMemo<TripModeDataContextValue>(
    () => ({
      context,
      itinerary: itineraryQuery.data,
      refresh,
      reservations: reservationsQuery.data?.reservations ?? null,
      setItinerary: itineraryQuery.setData,
      status,
    }),
    [context, itineraryQuery.data, itineraryQuery.setData, refresh, reservationsQuery.data, status],
  );

  return <TripModeDataContext.Provider value={value}>{children}</TripModeDataContext.Provider>;
}

export function useTripModeData() {
  const value = useContext(TripModeDataContext);
  if (!value) throw new Error('useTripModeData must be used inside TripModeDataProvider');
  return value;
}
