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

import { queryKeys } from '@/lib/query/keys';

const ACTIVE_SESSION_POLL_MS = 1_500;

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
  const activeSession = session && isAiPlanningSessionGenerating(session.status) ? session : null;
  const activeSessionQuery = useQuery({
    enabled: Boolean(activeSession),
    queryFn: () => fetchAiPlanningSession(activeSession!.id),
    queryKey: queryKeys.aiPlanningSession(activeSession?.id ?? 'none'),
    refetchInterval: activeSession ? ACTIVE_SESSION_POLL_MS : false,
  });

  const publishSession = useCallback((next: AiPlanningSession | null) => {
    if (next && cancelledSessionIds.current.has(next.id)) return;
    setSession(next);
  }, []);

  const recover = useCallback(async () => {
    const result = await recoveryQuery.refetch();
    return result.data?.session ?? null;
  }, [recoveryQuery.refetch]);

  useEffect(() => {
    if (!recoveredSession || cancelledSessionIds.current.has(recoveredSession.id)) return;
    setSession(recoveredSession);
    // A recovered prompt is the traveller's own words coming back to them, but
    // it must never overwrite words they are in the middle of typing.
    if (!promptTouched.current) setPromptValue(recoveredSession.prompt ?? '');
  }, [recoveredSession]);

  useEffect(() => {
    if (activeSessionQuery.data?.session) publishSession(activeSessionQuery.data.session);
  }, [activeSessionQuery.data?.session, publishSession]);

  useEffect(() => {
    if (!activeSessionQuery.error) return;
    const code =
      activeSessionQuery.error instanceof AiPlanningApiError
        ? activeSessionQuery.error.code
        : 'request_failed';
    if (code === 'session_expired') {
      publishSession(null);
      setPromptValue('');
      promptTouched.current = false;
    }
    setRequestError(code);
  }, [activeSessionQuery.error, publishSession]);

  // The Create endpoint reserves before it completes the synchronous pipeline.
  // A parallel recovery read gives the takeover a session ID and a cancellable
  // stage without ever sending a second Create request.
  useEffect(() => {
    if (operation !== 'starting' || session) return;
    let current = true;
    const attemptRecovery = async () => {
      try {
        const recovered = await recover();
        if (current && recovered) publishSession(recovered);
      } catch {
        // The original request owns its visible failure state. Recovery is only
        // a resumability aid and must not turn an incidental read failure into a
        // second error for the traveller.
      }
    };
    void attemptRecovery();
    const timer = window.setInterval(() => void attemptRecovery(), ACTIVE_SESSION_POLL_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [operation, publishSession, recover, session]);

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
  }, [operation, queryClient, session?.id]);

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
