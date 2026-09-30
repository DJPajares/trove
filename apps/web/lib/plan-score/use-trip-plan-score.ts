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
import { serverNow } from './clock';
import { assessmentDeadline, currentAssessment, hasUnsyncedScoringEdits } from './presentation';
import {
  assessmentChange,
  refreshExpiredAssessment,
  rememberAssessment,
  planScoreReadPolicy,
} from './lifecycle';

export type PlanScoreLoadStatus =
  'disabled' | 'error' | 'idle' | 'loading' | 'expired' | 'offline' | 'syncing' | 'updating';

/**
 * Automatic cache-only rereads for an assessment that is not current, before
 * the traveller is asked to retry: straight away, then after a short wait in
 * case a deadline passed in flight. Focus, reconnect, a passed deadline and
 * Try again each restore the budget.
 */
const AUTOMATIC_REFRESH_DELAYS_MS = [0, 2_000, 10_000] as const;

/** One in-memory trip assessment. Every refresh reads existing evidence only. */
export function useTripPlanScore(tripId: string | null) {
  const client = useQueryClient();
  const [clock, setClock] = useState(() => Date.now());
  const [refreshes, setRefreshes] = useState<{ tripId: string | null; count: number }>({
    tripId,
    count: 0,
  });
  const refreshCount = refreshes.tripId === tripId ? refreshes.count : 0;
  const restoreRefreshes = useCallback(() => setRefreshes({ tripId, count: 0 }), [tripId]);
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
        setRefreshes({ tripId, count: 0 });
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
    ...planScoreReadPolicy,
  });
  const data = query.data ?? null;
  useEffect(() => {
    if (!tripId || !canRead || query.data !== null) return;
    const recheck = () => {
      void client.invalidateQueries(
        { queryKey: queryKeys.planScore(tripId) },
        { cancelRefetch: false },
      );
    };
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [client, tripId, canRead, query.data]);
  useEffect(() => {
    if (!data || !tripId) return;
    rememberAssessment(client, tripId, data);
    const deadline = assessmentDeadline(data);
    if (!Number.isFinite(deadline)) return;
    // Deadlines are server time; the device waits out the corrected interval.
    const timer = window.setTimeout(
      () => {
        setClock(Date.now());
        restoreRefreshes();
      },
      Math.max(0, deadline - serverNow() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [client, tripId, data, restoreRefreshes]);
  const current = Boolean(data && currentAssessment(data, serverNow(Math.max(clock, Date.now()))));
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  // A settled assessment that is not current rereads the stored evidence on its
  // own; the traveller only sees "expired" once those rereads fail.
  const refreshing =
    Boolean(data && tripId && canRead && visible) &&
    !current &&
    refreshCount < AUTOMATIC_REFRESH_DELAYS_MS.length;
  useEffect(() => {
    if (!tripId || !data || !refreshing || query.isFetching) return;
    const timer = window.setTimeout(() => {
      setRefreshes({ tripId, count: refreshCount + 1 });
      refreshExpiredAssessment(client, tripId, data, serverNow());
    }, AUTOMATIC_REFRESH_DELAYS_MS[refreshCount]);
    return () => window.clearTimeout(timer);
  }, [client, tripId, data, refreshing, refreshCount, query.isFetching]);
  useEffect(() => {
    if (current && refreshCount) restoreRefreshes();
  }, [current, refreshCount, restoreRefreshes]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      setClock(Date.now());
      restoreRefreshes();
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [restoreRefreshes]);
  const retry = useCallback(() => {
    if (!tripId || !canRead) return;
    restoreRefreshes();
    void client.invalidateQueries(
      { queryKey: queryKeys.planScore(tripId) },
      { cancelRefetch: false },
    );
  }, [client, tripId, canRead, restoreRefreshes]);
  const status: PlanScoreLoadStatus = !tripId
    ? 'idle'
    : !ready
      ? 'loading'
      : !connectivity.online
        ? 'offline'
        : connectivity.pending
          ? 'syncing'
          : query.data === null && !query.isFetching
            ? 'disabled'
            : query.isPending
              ? 'loading'
              : query.isFetching || refreshing
                ? 'updating'
                : query.error
                  ? 'error'
                  : data && !current
                    ? 'expired'
                    : 'idle';
  return {
    data,
    retry,
    status,
    changeFor: (scope: string) => (tripId ? assessmentChange(client, tripId, scope) : null),
  };
}
