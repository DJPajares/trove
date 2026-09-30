import type { Query, QueryClient } from '@tanstack/react-query';
import type { TripPlanScore } from '@trove/types';
import {
  compareScores,
  currentAssessment,
  scoreSnapshot,
  type ScoreChange,
  type ScoreSnapshot,
} from './presentation';
import { serverNow } from './clock';

const histories = new WeakMap<
  QueryClient,
  Map<string, { latest: ScoreSnapshot; previous?: ScoreSnapshot }>
>();
const queuedEvidenceRefreshes = new WeakMap<QueryClient, Set<string>>();
const expiryRefreshes = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/** Start the canonical read before navigation; the destination observer joins this query. */
export function startCanonicalPlanScoreRead(
  client: QueryClient,
  tripId: string,
  read: (signal?: AbortSignal) => Promise<TripPlanScore | null>,
) {
  return client.fetchQuery({
    queryKey: ['plan-score', tripId],
    queryFn: ({ signal }) => read(signal),
    staleTime: 0,
  });
}
export function rememberAssessment(client: QueryClient, tripId: string, score: TripPlanScore) {
  let history = histories.get(client);
  if (!history) histories.set(client, (history = new Map()));
  const existing = history.get(tripId),
    latest = scoreSnapshot(score);
  if (existing?.latest.fingerprint === latest.fingerprint) return;
  history.set(tripId, { latest, previous: existing?.latest });
}
export function assessmentChange(
  client: QueryClient,
  tripId: string,
  scope: string,
): ScoreChange | null {
  const history = histories.get(client)?.get(tripId);
  return history?.previous ? compareScores(history.previous, history.latest, scope) : null;
}
/** Multiple mounted surfaces share only the in-flight cache-only read. */
export function refreshExpiredAssessment(
  client: QueryClient,
  tripId: string,
  score: TripPlanScore,
  now = serverNow(),
) {
  if (currentAssessment(score, now)) return;
  let refreshes = expiryRefreshes.get(client);
  if (!refreshes) expiryRefreshes.set(client, (refreshes = new Map()));
  if (refreshes.has(tripId)) return;
  const queryKey = ['plan-score', tripId];
  if (client.getQueryCache().find({ queryKey, exact: true })?.state.fetchStatus === 'fetching')
    return;
  const pending = client.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false });
  const settled = pending.then(
    () => undefined,
    () => undefined,
  );
  refreshes.set(tripId, settled);
  void settled.finally(() => {
    if (refreshes.get(tripId) === settled) refreshes.delete(tripId);
  });
}

/** Ordinary acquisition can supply scoring evidence. Only existing score queries are refreshed. */
export function watchScoringAcquisition(client: QueryClient) {
  return client.getQueryCache().subscribe((event) => {
    if (
      event.type === 'removed' &&
      event.query.queryKey[0] === 'ai-planning' &&
      event.query.queryKey[1] === 'session'
    ) {
      histories.get(client)?.delete(`draft:${event.query.queryKey[2]}`);
    }
    if (event.type === 'removed' && event.query.queryKey[0] === 'plan-score') {
      const tripId = String(event.query.queryKey[1]);
      histories.get(client)?.delete(tripId);
      expiryRefreshes.get(client)?.delete(tripId);
    }
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    const [root, tripId] = event.query.queryKey;
    if (root === 'plan-score' && typeof tripId === 'string') {
      const score = event.query.state.data as TripPlanScore | null;
      if (score?.fingerprint) rememberAssessment(client, tripId, score);
      return;
    }
    if (
      !['itinerary-day-routes', 'trip-mode-context', 'trip-weather', 'place-rich-details'].includes(
        String(root),
      )
    )
      return;
    for (const query of client.getQueryCache().findAll({
      predicate: (query) =>
        query.queryKey[0] === 'plan-score' &&
        (root === 'place-rich-details' || query.queryKey[1] === tripId),
    }))
      refreshAfterAcquisition(client, query);
  });
}

/** An in-flight read may have captured the old evidence. Coalesce one follow-up after it settles. */
function refreshAfterAcquisition(client: QueryClient, query: Query) {
  const options = { queryKey: query.queryKey, exact: true };
  if (query.state.fetchStatus !== 'fetching' || !query.promise) {
    void client.invalidateQueries(options, { cancelRefetch: false });
    return;
  }
  let queued = queuedEvidenceRefreshes.get(client);
  if (!queued) queuedEvidenceRefreshes.set(client, (queued = new Set()));
  if (queued.has(query.queryHash)) return;
  queued.add(query.queryHash);
  void client.invalidateQueries({ ...options, refetchType: 'none' });
  const refresh = () => {
    queued.delete(query.queryHash);
    if (client.getQueryCache().find(options) === query)
      void client.invalidateQueries(options, { cancelRefetch: false });
  };
  void query.promise.then(refresh, refresh);
}

/** Disabled responses have no assessment lifetime; cache-only reads may recheck on mount/focus. */
export const planScoreReadPolicy = {
  staleTime: (query: Query<TripPlanScore | null>) => (query.state.data === null ? 0 : Infinity),
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
