'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SheetFooter } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  AiPlanningApiError,
  cancelAiPlanningSession,
  createAiPlanningSession,
  fetchAiPlanningAvailability,
  fetchAiPlanningSession,
  regenerateAiPlanningSession,
  type AiPlanningSession,
} from '@/lib/ai-planning/api';
import {
  AI_PLANNING_PROMPT_MAX_LENGTH,
  aiPlanningErrorMessageKey,
  isAiPlanningPromptValid,
  isAiPlanningSessionGenerating,
} from '@/lib/ai-planning/presentation';
import { queryKeys } from '@/lib/query/keys';

const ACTIVE_SESSION_POLL_MS = 1_500;

type AiPlanningComposerProps = {
  onRecover: () => Promise<AiPlanningSession | null>;
  onSessionChange: (session: AiPlanningSession | null) => void;
  recoveredSession: AiPlanningSession | null;
};

type PendingPlanningAttempt = {
  idempotencyKey: string;
  prompt: string;
  revision: number | null;
  sessionId: string | null;
};

function retryAtLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/**
 * This is deliberately one prompt and one lifecycle, not a chat surface. The
 * review lives in WDL-223; this composer only starts, resumes, retries, or
 * cancels the draft that its authenticated session already owns.
 */
export function AiPlanningComposer({
  onRecover,
  onSessionChange,
  recoveredSession,
}: Readonly<AiPlanningComposerProps>) {
  const t = useTranslations('trips.aiPlanning');
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState(recoveredSession?.prompt ?? '');
  const [session, setSession] = useState<AiPlanningSession | null>(recoveredSession);
  const [operation, setOperation] = useState<'cancelling' | 'idle' | 'starting'>('idle');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const attempt = useRef(0);
  const pendingPlanningAttempt = useRef<PendingPlanningAttempt | null>(null);
  const cancelledSessionIds = useRef(new Set<string>());

  const availabilityQuery = useQuery({
    queryFn: fetchAiPlanningAvailability,
    queryKey: queryKeys.aiPlanningAvailability(),
  });
  const activeSession = session && isAiPlanningSessionGenerating(session.status) ? session : null;
  const activeSessionQuery = useQuery({
    enabled: Boolean(activeSession),
    queryFn: () => fetchAiPlanningSession(activeSession!.id),
    queryKey: queryKeys.aiPlanningSession(activeSession?.id ?? 'none'),
    refetchInterval: activeSession ? ACTIVE_SESSION_POLL_MS : false,
  });

  const publishSession = useCallback(
    (next: AiPlanningSession | null) => {
      if (next && cancelledSessionIds.current.has(next.id)) return;
      setSession(next);
      onSessionChange(next);
    },
    [onSessionChange],
  );

  useEffect(() => {
    if (!recoveredSession || cancelledSessionIds.current.has(recoveredSession.id)) return;
    setSession(recoveredSession);
    setPrompt(recoveredSession.prompt ?? '');
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
      setPrompt('');
    }
    setRequestError(code);
  }, [activeSessionQuery.error, publishSession]);

  // The Create endpoint reserves before it completes the synchronous pipeline.
  // A parallel recovery read gives this view a session ID and cancellable stage
  // without ever sending a second Create request.
  useEffect(() => {
    if (operation !== 'starting' || session) return;
    let current = true;
    const recover = async () => {
      try {
        const recovered = await onRecover();
        if (current && recovered) publishSession(recovered);
      } catch {
        // The original request owns its visible failure state. Recovery is only
        // a resumability aid and must not turn an incidental read failure into a
        // second error for the traveller.
      }
    };
    void recover();
    const timer = window.setInterval(() => void recover(), ACTIVE_SESSION_POLL_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [onRecover, operation, publishSession, session]);

  const availability = availabilityQuery.data?.availability;
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

  async function refreshAvailability() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.aiPlanningAvailability() });
  }

  function updatePrompt(value: string) {
    pendingPlanningAttempt.current = null;
    setPrompt(value);
    setCancelled(false);
    setRequestError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  async function handleCancel() {
    if (!session || operation !== 'idle') return;
    const sessionId = session.id;
    attempt.current += 1;
    setOperation('cancelling');
    setRequestError(null);

    try {
      await cancelAiPlanningSession(sessionId);
      cancelledSessionIds.current.add(sessionId);
      queryClient.removeQueries({ queryKey: queryKeys.aiPlanningSession(sessionId) });
      publishSession(null);
      pendingPlanningAttempt.current = null;
      setPrompt('');
      setCancelled(true);
    } catch (error) {
      setRequestError(error instanceof AiPlanningApiError ? error.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  const progressLabel = session ? t(`stages.${session.stage}`) : t('stages.created');
  const errorKey = aiPlanningErrorMessageKey(visibleError);
  const planningInProgress = operation === 'starting' || generating;

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6">
        <Field>
          <FieldLabel htmlFor="ai-planning-prompt">{t('promptLabel')}</FieldLabel>
          <Textarea
            aria-describedby="ai-planning-prompt-hint"
            disabled={operation !== 'idle' || generating}
            id="ai-planning-prompt"
            maxLength={AI_PLANNING_PROMPT_MAX_LENGTH}
            onChange={(event) => {
              updatePrompt(event.target.value);
            }}
            placeholder={t('promptPlaceholder')}
            value={prompt}
          />
          <FieldDescription id="ai-planning-prompt-hint">{t('promptHint')}</FieldDescription>
        </Field>

        <section aria-label={t('examplesLabel')} className="space-y-2">
          <p className="text-sm font-medium">{t('examplesLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {(['cityBreak', 'workTrip', 'suggestion'] as const).map((example) => (
              <Button
                disabled={operation !== 'idle' || generating}
                key={example}
                onClick={() => updatePrompt(t(`examples.${example}`))}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t(`exampleLabels.${example}`)}
              </Button>
            ))}
          </div>
        </section>

        {availability?.status === 'available' ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('availability', { count: availability.remainingDispatches ?? 0 })}
          </p>
        ) : null}
        {availability?.status === 'quota_exhausted' ? (
          <Alert role="alert" variant="warning">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t('errors.quota_exceeded')}</AlertTitle>
            <AlertDescription>
              {availability.retryAt
                ? t('quotaRetryAt', { retryAt: retryAtLabel(availability.retryAt) })
                : t('quotaRetryUnknown')}
            </AlertDescription>
          </Alert>
        ) : null}
        {availability?.status === 'unavailable' ? (
          <Alert role="alert" variant="warning">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t(`errors.${aiPlanningErrorMessageKey(availability.code)}`)}</AlertTitle>
            <AlertDescription>{t('manualFallbackHint')}</AlertDescription>
          </Alert>
        ) : null}

        {planningInProgress ? (
          <div
            aria-busy="true"
            aria-live="polite"
            className="rounded-[var(--radius-md)] bg-muted/45 p-4"
            role="status"
          >
            <div className="flex items-start gap-3">
              <Sparkles aria-hidden="true" className="mt-0.5 size-4 text-brand" />
              <div className="space-y-1">
                <p className="font-medium">{progressLabel}</p>
                <p className="text-sm text-muted-foreground">{t('workingHint')}</p>
              </div>
            </div>
          </div>
        ) : null}

        {session?.status === 'reviewing' ? (
          <Alert role="status" variant="success">
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{t('reviewReadyTitle')}</AlertTitle>
            <AlertDescription>{t('reviewReadyDescription')}</AlertDescription>
          </Alert>
        ) : null}

        {visibleError ? (
          <Alert role="alert" variant={session?.status === 'reviewing' ? 'warning' : 'destructive'}>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{t(`errors.${errorKey}`)}</AlertTitle>
            <AlertDescription>{t('manualFallbackHint')}</AlertDescription>
          </Alert>
        ) : null}
        {!availability && availabilityError ? (
          <Button
            onClick={() => void availabilityQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('tryAgain')}
          </Button>
        ) : null}

        {cancelled ? (
          <Alert role="status" variant="info">
            <CircleCheck aria-hidden="true" />
            <AlertDescription>{t('cancelled')}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <SheetFooter className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        {generating && session ? (
          <Button
            disabled={operation === 'cancelling'}
            onClick={handleCancel}
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" data-icon="inline-start" />
            {operation === 'cancelling' ? t('cancelling') : t('cancel')}
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={!canGenerate} type="submit">
          <Sparkles aria-hidden="true" data-icon="inline-start" />
          {operation === 'starting' ? t('starting') : session ? t('regenerate') : t('generate')}
        </Button>
      </SheetFooter>
    </form>
  );
}
