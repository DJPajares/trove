'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AiPlanningApiError,
  cancelAiPlanningSession,
  createAiPlanningSession,
  fetchAiPlanningAvailability,
  fetchAiPlanningSession,
  recoverAiPlanningSession,
  regenerateAiPlanningSession,
  type AiPlanningAvailability,
  type AiPlanningSession,
} from './api';
import { isAiPlanningPromptValid, isAiPlanningSessionGenerating } from './presentation';
import { isAiPlanningSessionExpired, releasesMirroredAiPlanningSession } from './review';

import { queryKeys } from '@/lib/query/keys';

const INITIAL_SESSION_POLL_MS = 3_000;
const LATER_SESSION_POLL_MS = 5_000;

export type AiPlanningOperation = 'cancelling' | 'idle' | 'starting';

type PendingPlanningAttempt = {
  idempotencyKey: string;
  prompt: string;
  revision: number | null;
  sessionId: string | null;
};

/**
 * One prompt, one lifecycle. This is deliberately not a chat surface: it starts,
 * resumes, retries or cancels the single draft the authenticated session owns.
 *
 * It lives above the composer rather than inside it because a generation has to
 * outlast the sheet. The full-screen takeover and the creation sheet cannot both
 * be on screen — two focus traps arguing over the keyboard is not a design — so
 * the sheet closes the moment a run begins, and everything the run needs has to
 * already be somewhere that stays mounted.
 */
export function useAiPlanningLifecycle(enabled: boolean) {
  const queryClient = useQueryClient();
  const [prompt, setPromptValue] = useState('');
  const [session, setSession] = useState<AiPlanningSession | null>(null);
  const [operation, setOperation] = useState<AiPlanningOperation>('idle');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const attempt = useRef(0);
  const pendingPlanningAttempt = useRef<PendingPlanningAttempt | null>(null);
  const cancelledSessionIds = useRef(new Set<string>());
  const promptTouched = useRef(false);
  const mirroredRecoveryId = useRef<string | null>(null);

  const recoveryQuery = useQuery({
    enabled,
    queryFn: recoverAiPlanningSession,
    queryKey: queryKeys.aiPlanningRecovery(),
  });
  const availabilityQuery = useQuery({
    enabled,
    queryFn: fetchAiPlanningAvailability,
    queryKey: queryKeys.aiPlanningAvailability(),
  });
  const recoveredSession = recoveryQuery.data?.session ?? null;
  const recoveredSessionId = recoveredSession?.id ?? null;

  const discardExpiredSession = useCallback(
    (expiredSessionId: string) => {
      setSession(null);
      setPromptValue('');
      promptTouched.current = false;
      pendingPlanningAttempt.current = null;
      queryClient.setQueryData(queryKeys.aiPlanningSession(expiredSessionId), { session: null });
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
      setRequestError('session_expired');
      // The local cutoff is immediate. A connected read triggers the server's
      // request-time scrub instead of waiting for the maintenance sweep.
      void fetchAiPlanningSession(expiredSessionId).catch(() => undefined);
    },
    [queryClient],
  );

  const publishSession = useCallback(
    (next: AiPlanningSession | null) => {
      if (next && cancelledSessionIds.current.has(next.id)) return;
      if (next && isAiPlanningSessionExpired(next)) {
        discardExpiredSession(next.id);
        return;
      }
      setSession(next);
    },
    [discardExpiredSession],
  );

  const recover = useCallback(async () => {
    const result = await recoveryQuery.refetch();
    return result.data?.session ?? null;
  }, [recoveryQuery.refetch]);

  useEffect(() => {
    if (!recoveredSession || cancelledSessionIds.current.has(recoveredSession.id)) return;
    if (isAiPlanningSessionExpired(recoveredSession)) {
      discardExpiredSession(recoveredSession.id);
      return;
    }
    setSession(recoveredSession);
    // A recovered prompt is the traveller's own words coming back to them, but
    // it must never overwrite words they are in the middle of typing.
    if (!promptTouched.current) setPromptValue(recoveredSession.prompt ?? '');
  }, [discardExpiredSession, recoveredSession]);

  useEffect(() => {
    if (!session) return;
    const checkExpiry = () => {
      if (isAiPlanningSessionExpired(session)) discardExpiredSession(session.id);
    };
    const timer = window.setTimeout(
      checkExpiry,
      Math.max(0, Math.min(Date.parse(session.expiresAt) - Date.now(), 2_147_483_647)),
    );
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
    };
  }, [discardExpiredSession, session]);

  // The seeding above only copies recovery in. This copies it *out* again: when
  // recovery drops the session this hook was following — Apply empties that cache
  // — the mirror has to let go with it. `cancel` already pairs the two by hand;
  // this makes the pairing automatic rather than something every caller has to
  // remember, which is how the redirect loop came back.
  useEffect(() => {
    // A run in flight owns its session outright, and is deliberately ahead of
    // recovery. Recovery is only authoritative once that run has settled.
    if (operation !== 'idle') return;
    const previousRecoveredId = mirroredRecoveryId.current;
    mirroredRecoveryId.current = recoveredSessionId;
    setSession((current) =>
      releasesMirroredAiPlanningSession(current, previousRecoveredId, recoveredSessionId)
        ? null
        : current,
    );
  }, [operation, recoveredSessionId]);

  // Create reserves its session before the POST completes. Follow that one
  // session through recovery and stage reads; schedule the next read only after
  // the previous read has settled, so slow responses cannot pile up.
  useEffect(() => {
    const active = session && isAiPlanningSessionGenerating(session.status);
    if (!enabled || (!active && !(operation === 'starting' && !session))) return;
    let current = true;
    let timer: number | undefined;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const next = active ? (await fetchAiPlanningSession(session.id)).session : await recover();
        if (current && next) publishSession(next);
      } catch (error) {
        if (current && active) {
          const code = error instanceof AiPlanningApiError ? error.code : 'request_failed';
          if (code === 'session_expired') {
            publishSession(null);
            setPromptValue('');
            promptTouched.current = false;
          }
          setRequestError(code);
        }
      } finally {
        if (current) {
          const interval =
            Date.now() - startedAt < 30_000 ? INITIAL_SESSION_POLL_MS : LATER_SESSION_POLL_MS;
          const untilDeadline =
            active && session.deadlineAt ? Date.parse(session.deadlineAt) - Date.now() : interval;
          timer = window.setTimeout(poll, Math.max(1_000, Math.min(interval, untilDeadline)));
        }
      }
    };
    void poll();
    return () => {
      current = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    enabled,
    operation,
    publishSession,
    recover,
    session?.deadlineAt,
    session?.id,
    session?.status,
  ]);

  const availability: AiPlanningAvailability | undefined = availabilityQuery.data?.availability;
  const generating = Boolean(session && isAiPlanningSessionGenerating(session.status));
  const availabilityError =
    availabilityQuery.error instanceof AiPlanningApiError
      ? availabilityQuery.error.code
      : availabilityQuery.error
        ? 'request_failed'
        : null;
  const canGenerate =
    isAiPlanningPromptValid(prompt) &&
    !generating &&
    operation === 'idle' &&
    availability?.status === 'available';
  const visibleError =
    requestError ?? (availability ? null : availabilityError) ?? session?.lastSafeError ?? null;

  const setPrompt = useCallback((value: string) => {
    pendingPlanningAttempt.current = null;
    promptTouched.current = true;
    setPromptValue(value);
    setCancelled(false);
    setRequestError(null);
  }, []);

  const refreshAvailability = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.aiPlanningAvailability() }),
    [queryClient],
  );

  const generate = useCallback(async () => {
    if (!canGenerate) return;

    const requestAttempt = attempt.current + 1;
    attempt.current = requestAttempt;
    setCancelled(false);
    setRequestError(null);
    setOperation('starting');
    const trimmedPrompt = prompt.trim();
    const currentAttempt = {
      prompt: trimmedPrompt,
      revision: session?.draftRevision ?? null,
      sessionId: session?.id ?? null,
    };
    const previousAttempt = pendingPlanningAttempt.current;
    const idempotencyKey =
      previousAttempt &&
      previousAttempt.prompt === currentAttempt.prompt &&
      previousAttempt.revision === currentAttempt.revision &&
      previousAttempt.sessionId === currentAttempt.sessionId
        ? previousAttempt.idempotencyKey
        : crypto.randomUUID();
    pendingPlanningAttempt.current = { ...currentAttempt, idempotencyKey };

    try {
      const result = session
        ? await regenerateAiPlanningSession(
            session.id,
            trimmedPrompt,
            session.draftRevision,
            idempotencyKey,
          )
        : await createAiPlanningSession(trimmedPrompt, idempotencyKey);
      if (attempt.current === requestAttempt) {
        pendingPlanningAttempt.current = null;
        publishSession(result.session);
      }
    } catch (error) {
      if (attempt.current === requestAttempt) {
        setRequestError(error instanceof AiPlanningApiError ? error.code : 'request_failed');
      }
    } finally {
      if (attempt.current === requestAttempt) setOperation('idle');
      await refreshAvailability();
    }
  }, [canGenerate, prompt, publishSession, refreshAvailability, session]);

  const cancel = useCallback(async () => {
    const sessionId = session?.id;
    if (!sessionId || operation === 'cancelling') return;
    attempt.current += 1;
    setOperation('cancelling');
    setRequestError(null);

    try {
      await cancelAiPlanningSession(sessionId);
    } catch (error) {
      setRequestError(error instanceof AiPlanningApiError ? error.code : 'request_failed');
      setOperation('idle');
      return;
    }

    cancelledSessionIds.current.add(sessionId);
    queryClient.removeQueries({ queryKey: queryKeys.aiPlanningSession(sessionId) });
    queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
    setSession(null);
    pendingPlanningAttempt.current = null;
    setPromptValue('');
    promptTouched.current = false;
    setCancelled(true);
    setOperation('idle');
    await refreshAvailability();
  }, [operation, queryClient, refreshAvailability, session?.id]);

  return {
    availability,
    availabilityError,
    canGenerate,
    cancel,
    cancelled,
    generate,
    generating,
    operation,
    prompt,
    refetchAvailability: () => void availabilityQuery.refetch(),
    refreshRecovery: () => void recover(),
    session,
    setPrompt,
    visibleError,
  };
}

export type AiPlanningLifecycle = ReturnType<typeof useAiPlanningLifecycle>;
