'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { fetchTripPlanScore } from '@/lib/plan-score/api';
import { queryKeys } from '@/lib/query/keys';
import {
  getRememberedOfflineUser,
  isOfflineApiReachable,
  listUserMutations,
  OFFLINE_CONNECTIVITY_EVENT,
  OFFLINE_DATA_REFRESH_EVENT,
  OFFLINE_SYNC_EVENT,
} from '@/lib/offline/trip-store';
import { assessmentDeadline, currentAssessment, hasUnsyncedScoringEdits } from './presentation';
import { assessmentChange, refreshExpiredAssessment, rememberAssessment } from './lifecycle';

export type PlanScoreLoadStatus =
  'disabled' | 'error' | 'idle' | 'loading' | 'expired' | 'offline' | 'syncing' | 'updating';

/** One in-memory trip assessment. Every refresh reads existing evidence only. */
export function useTripPlanScore(tripId: string | null) {
  const client = useQueryClient();
  const [clock, setClock] = useState(() => Date.now());
  const [connectivity, setConnectivity] = useState<{
    tripId: string | null;
    online: boolean;
    pending: boolean;
    ready: boolean;
  }>({ tripId: null, online: true, pending: false, ready: false });
  useEffect(() => {
    let active = true,
      request = 0;
    const check = async () => {
      const version = ++request;
      const online = navigator.onLine && isOfflineApiReachable();
      const userId = getRememberedOfflineUser();
      // If storage fails, we cannot establish that local scoring edits are synchronized.
      const pending =
        userId && tripId
          ? await listUserMutations(userId, tripId)
              .then((rows) => hasUnsyncedScoringEdits(rows.map((row) => row.operation)))
              .catch(() => true)
          : false;
      if (active && version === request) {
        setConnectivity({ tripId, online, pending: Boolean(pending), ready: true });
        setClock(Date.now());
      }
    };
    void check();
    const events = [
      'online',
      'offline',
      'focus',
      OFFLINE_CONNECTIVITY_EVENT,
      OFFLINE_SYNC_EVENT,
      OFFLINE_DATA_REFRESH_EVENT,
    ];
    events.forEach((event) => window.addEventListener(event, check));
    return () => {
      active = false;
      events.forEach((event) => window.removeEventListener(event, check));
    };
  }, [tripId]);
  const ready = connectivity.ready && connectivity.tripId === tripId;
  const canRead = ready && connectivity.online && !connectivity.pending;
  const query = useQuery({
    enabled: tripId !== null && canRead,
    queryFn: ({ signal }) => fetchTripPlanScore(tripId as string, signal),
    queryKey: queryKeys.planScore(tripId ?? ''),
  });
  const data = query.data ?? null;
  useEffect(() => {
    if (!data || !tripId) return;
    rememberAssessment(client, tripId, data);
    setClock(Date.now());
    const deadline = assessmentDeadline(data);
    if (!Number.isFinite(deadline)) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, deadline - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [client, tripId, data]);
  useEffect(() => {
    if (
      tripId &&
      data &&
      canRead &&
      document.visibilityState !== 'hidden' &&
      !currentAssessment(data, Math.max(clock, Date.now()))
    )
      refreshExpiredAssessment(client, tripId, data, Math.max(clock, Date.now()));
  }, [client, tripId, data, clock, canRead]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setClock(Date.now());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  const retry = useCallback(() => {
    if (tripId && canRead)
      void client.invalidateQueries(
        { queryKey: queryKeys.planScore(tripId) },
        { cancelRefetch: false },
      );
  }, [client, tripId, canRead]);
  const status: PlanScoreLoadStatus = !tripId
    ? 'idle'
    : query.data === null
      ? 'disabled'
      : !ready
        ? 'loading'
        : !connectivity.online
          ? 'offline'
          : connectivity.pending
            ? 'syncing'
            : query.error
              ? 'error'
              : query.isPending
                ? 'loading'
                : data && !currentAssessment(data, Math.max(clock, Date.now()))
                  ? 'expired'
                  : query.isFetching && query.isStale
                    ? 'updating'
                    : 'idle';
  return {
    data,
    retry,
    status,
    changeFor: (scope: string) => (tripId ? assessmentChange(client, tripId, scope) : null),
  };
}
