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
import { composeAiPlanningBrief, type AiPlanningBriefSelection } from './brief';
import { isAiPlanningPromptValid, isAiPlanningSessionGenerating } from './presentation';
import { isAiPlanningSessionExpired, releasesMirroredAiPlanningSession } from './review';

import { isAuthDeparting, subscribeAuthTransition } from '@/lib/auth/transition';
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
export function useAiPlanningLifecycle(
  enabled: boolean,
  /** Turns a composed brief back into the traveller's words and choices. */
  splitBrief?: (prompt: string) => { selections: AiPlanningBriefSelection[]; text: string },
) {
  const queryClient = useQueryClient();
  // The traveller's own words, and the choices that travel with them. Both live
  // here rather than in the drawer so a failed run reopens it exactly as it was.
  const [prompt, setPromptValue] = useState('');
  const [briefSelections, setBriefSelectionsValue] = useState<AiPlanningBriefSelection[]>([]);
  const splitBriefRef = useRef(splitBrief);
  splitBriefRef.current = splitBrief;
  const [session, setSession] = useState<AiPlanningSession | null>(null);
  const [operation, setOperation] = useState<AiPlanningOperation>('idle');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [retainedBriefExpiresAt, setRetainedBriefExpiresAt] = useState<string | null>(null);
  const attempt = useRef(0);
  const pendingPlanningAttempt = useRef<PendingPlanningAttempt | null>(null);
  const retiredSessionIds = useRef(new Set<string>());
  const promptTouched = useRef(false);
  const mirroredRecoveryId = useRef<string | null>(null);
  const pendingCancellation = useRef<{ clearBrief: boolean; runAttempt: number } | null>(null);
  const cancellingSessionId = useRef<string | null>(null);
  const cancelSessionRef = useRef<(next: AiPlanningSession) => Promise<void>>(
    async () => undefined,
  );

  const clearBrief = useCallback(() => {
    setPromptValue('');
    setBriefSelectionsValue([]);
    setRetainedBriefExpiresAt(null);
    promptTouched.current = false;
    pendingPlanningAttempt.current = null;
  }, []);

  useEffect(() => {
    if (enabled) return;
    attempt.current += 1;
    pendingCancellation.current = null;
    cancellingSessionId.current = null;
    retiredSessionIds.current.clear();
    mirroredRecoveryId.current = null;
    clearBrief();
    setSession(null);
    setOperation('idle');
    setCancelled(false);
    setRequestError(null);
  }, [enabled, clearBrief]);

  useEffect(
    () =>
      subscribeAuthTransition(() => {
        if (!isAuthDeparting()) return;
        attempt.current += 1;
        pendingCancellation.current = null;
        cancellingSessionId.current = null;
        clearBrief();
        setSession(null);
        setOperation('idle');
        setCancelled(false);
      }),
    [clearBrief],
  );

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
      attempt.current += 1;
      retiredSessionIds.current.add(expiredSessionId);
      pendingCancellation.current = null;
      cancellingSessionId.current = null;
      setSession(null);
      clearBrief();
      setOperation('idle');
      setCancelled(false);
      queryClient.setQueryData(queryKeys.aiPlanningSession(expiredSessionId), { session: null });
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
      setRequestError('session_expired');
      // The local cutoff is immediate. A connected read triggers the server's
      // request-time scrub instead of waiting for the maintenance sweep.
      void fetchAiPlanningSession(expiredSessionId).catch(() => undefined);
    },
    [clearBrief, queryClient],
  );

  const publishSession = useCallback(
    (next: AiPlanningSession | null) => {
      if (next && retiredSessionIds.current.has(next.id)) return;
      if (next && pendingCancellation.current) {
        void cancelSessionRef.current(next);
        return;
      }
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
    if (
      !enabled ||
      isAuthDeparting() ||
      !recoveredSession ||
      retiredSessionIds.current.has(recoveredSession.id)
    )
      return;
    if (isAiPlanningSessionExpired(recoveredSession)) {
      discardExpiredSession(recoveredSession.id);
      return;
    }
    publishSession(recoveredSession);
    // A recovered prompt is the traveller's own words coming back to them, but
    // it must never overwrite words they are in the middle of typing.
    if (!promptTouched.current && !pendingCancellation.current) {
      const recovered = recoveredSession.prompt ?? '';
      const brief = splitBriefRef.current?.(recovered) ?? { selections: [], text: recovered };
      setPromptValue(brief.text);
      setBriefSelectionsValue(brief.selections);
    }
  }, [discardExpiredSession, enabled, publishSession, recoveredSession]);

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

  useEffect(() => {
    if (!retainedBriefExpiresAt) return;
    const expireBrief = () => {
      if (Date.parse(retainedBriefExpiresAt) > Date.now()) return;
      clearBrief();
      setCancelled(false);
      setRequestError('session_expired');
    };
    const timer = window.setTimeout(
      expireBrief,
      Math.max(0, Date.parse(retainedBriefExpiresAt) - Date.now()),
    );
    window.addEventListener('focus', expireBrief);
    document.addEventListener('visibilitychange', expireBrief);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', expireBrief);
      document.removeEventListener('visibilitychange', expireBrief);
    };
  }, [clearBrief, retainedBriefExpiresAt]);

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
    if (releasesMirroredAiPlanningSession(session, previousRecoveredId, recoveredSessionId)) {
      if (session) retiredSessionIds.current.add(session.id);
      setSession(null);
      clearBrief();
    }
  }, [operation, recoveredSessionId, session, clearBrief]);

  // Create reserves its session before the POST completes. Follow that one
  // session through recovery and stage reads; schedule the next read only after
  // the previous read has settled, so slow responses cannot pile up.
  useEffect(() => {
    const active = session && isAiPlanningSessionGenerating(session.status);
    if (!enabled || (!active && !(['starting', 'cancelling'].includes(operation) && !session)))
      return;
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
            discardExpiredSession(session.id);
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
    discardExpiredSession,
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
  const composedPrompt = composeAiPlanningBrief(prompt, briefSelections);
  const canGenerate =
    isAiPlanningPromptValid(composedPrompt) &&
    !generating &&
    operation === 'idle' &&
    availability?.status === 'available';
  const visibleError =
    requestError ?? (availability ? null : availabilityError) ?? session?.lastSafeError ?? null;

  const setPrompt = useCallback((value: string) => {
    pendingPlanningAttempt.current = null;
    promptTouched.current = true;
    setPromptValue(value);
    setRetainedBriefExpiresAt(null);
    setCancelled(false);
    setRequestError(null);
  }, []);

  const setBriefSelections = useCallback((value: AiPlanningBriefSelection[]) => {
    pendingPlanningAttempt.current = null;
    promptTouched.current = true;
    setBriefSelectionsValue(value);
    setRetainedBriefExpiresAt(null);
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
    setRetainedBriefExpiresAt(null);
    const trimmedPrompt = composedPrompt.trim();
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
      if (pendingCancellation.current?.runAttempt === requestAttempt) {
        await cancelSessionRef.current(result.session);
      } else if (attempt.current === requestAttempt) {
        pendingPlanningAttempt.current = null;
        publishSession(result.session);
      }
    } catch (error) {
      // The request may have reserved a session even if its response was lost.
      if (
        pendingCancellation.current?.runAttempt === requestAttempt &&
        !cancellingSessionId.current
      ) {
        try {
          const reserved = await recover();
          if (reserved) await cancelSessionRef.current(reserved);
          else {
            pendingCancellation.current = null;
            pendingPlanningAttempt.current = null;
            setCancelled(true);
            setOperation('idle');
          }
        } catch {
          // Keep polling and keep retry disabled until reservation state is known.
          setRequestError('request_failed');
        }
      } else if (attempt.current === requestAttempt) {
        setRequestError(error instanceof AiPlanningApiError ? error.code : 'request_failed');
      }
    } finally {
      if (attempt.current === requestAttempt) setOperation('idle');
      await refreshAvailability();
    }
  }, [canGenerate, composedPrompt, publishSession, recover, refreshAvailability, session]);

  const cancelSession = useCallback(
    async (next: AiPlanningSession) => {
      const sessionId = next.id;
      if (!pendingCancellation.current || cancellingSessionId.current) return;
      cancellingSessionId.current = sessionId;
      const cancellationAttempt = attempt.current;
      try {
        await cancelAiPlanningSession(sessionId);
      } catch (error) {
        if (attempt.current !== cancellationAttempt) return;
        pendingCancellation.current = null;
        cancellingSessionId.current = null;
        setRequestError(error instanceof AiPlanningApiError ? error.code : 'request_failed');
        setOperation('idle');
        void recover();
        return;
      }
      if (attempt.current !== cancellationAttempt) return;
      const reset = pendingCancellation.current?.clearBrief;
      retiredSessionIds.current.add(sessionId);
      queryClient.removeQueries({ queryKey: queryKeys.aiPlanningSession(sessionId) });
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
      setSession(null);
      pendingPlanningAttempt.current = null;
      pendingCancellation.current = null;
      cancellingSessionId.current = null;
      if (reset) clearBrief();
      else {
        promptTouched.current = true;
        setRetainedBriefExpiresAt(next.expiresAt);
      }
      setCancelled(!reset);
      setOperation('idle');
      await refreshAvailability();
    },
    [clearBrief, queryClient, recover, refreshAvailability],
  );
  cancelSessionRef.current = cancelSession;

  const cancel = useCallback(
    async (clear = false) => {
      if (pendingCancellation.current) return;
      if (!session && operation !== 'starting') {
        if (clear) clearBrief();
        return;
      }
      const runAttempt = attempt.current;
      attempt.current += 1;
      pendingCancellation.current = { clearBrief: clear, runAttempt };
      setOperation('cancelling');
      setRequestError(null);
      if (session) await cancelSession(session);
      // Before Create returns, recovery or its eventual response supplies the ID.
    },
    [cancelSession, clearBrief, operation, session],
  );

  return {
    availability,
    availabilityError,
    briefSelections,
    canGenerate,
    composedPrompt,
    cancel,
    cancelled,
    generate,
    generating,
    operation,
    prompt,
    refetchAvailability: () => void availabilityQuery.refetch(),
    refreshRecovery: () => void recover(),
    session,
    setBriefSelections,
    setPrompt,
    startOver: () => cancel(true),
    visibleError,
  };
}

export type AiPlanningLifecycle = ReturnType<typeof useAiPlanningLifecycle>;
