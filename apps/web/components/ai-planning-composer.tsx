'use client';

import { CircleAlert, CircleCheck, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SheetFooter } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { AiPlanningLifecycle } from '@/lib/ai-planning/use-lifecycle';
import { aiPlanningExampleRotation, type AiPlanningExampleId } from '@/lib/ai-planning/examples';
import {
  AI_PLANNING_PROMPT_MAX_LENGTH,
  aiPlanningErrorMessageKey,
} from '@/lib/ai-planning/presentation';

function retryAtLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/**
 * The prompt half of AI planning. It owns the form and nothing else: the run it
 * starts outlives this sheet, so the lifecycle it drives lives in
 * `useAiPlanningLifecycle` above it and arrives here as one object.
 */
export function AiPlanningComposer({ lifecycle }: Readonly<{ lifecycle: AiPlanningLifecycle }>) {
  const t = useTranslations('trips.aiPlanning');
  const [examples, setExamples] = useState<readonly AiPlanningExampleId[]>([]);
  const [examplesAnnouncement, setExamplesAnnouncement] = useState('');
  const initializedExamples = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const {
    availability,
    availabilityError,
    canGenerate,
    cancel,
    cancelled,
    generate,
    generating,
    operation,
    prompt,
    refetchAvailability,
    session,
    setPrompt,
    visibleError,
  } = lifecycle;
  const errorKey = aiPlanningErrorMessageKey(visibleError);

  useEffect(() => {
    // Mounting marks a new opening, including returning from the manual tab.
    // Strict Mode replays this effect; it must not consume a second set.
    if (initializedExamples.current) return;
    initializedExamples.current = true;
    setExamples(aiPlanningExampleRotation.next());
  }, []);

  function showMoreExamples() {
    const next = aiPlanningExampleRotation.next();
    setExamples(next);
    setExamplesAnnouncement(
      t('examplesUpdated', { examples: next.map((id) => t(`exampleLabels.${id}`)).join(', ') }),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generate();
  }

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
              setPrompt(event.target.value);
            }}
            placeholder={t('promptPlaceholder')}
            ref={promptRef}
            value={prompt}
          />
          <FieldDescription id="ai-planning-prompt-hint">{t('promptHint')}</FieldDescription>
        </Field>

        <section aria-label={t('examplesLabel')} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{t('examplesLabel')}</p>
            <Button
              disabled={operation !== 'idle' || generating || examples.length === 0}
              onClick={showMoreExamples}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t('moreExamples')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <Button
                disabled={operation !== 'idle' || generating}
                key={example}
                onClick={() => {
                  setPrompt(t(`examples.${example}`));
                  promptRef.current?.focus();
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t(`exampleLabels.${example}`)}
              </Button>
            ))}
          </div>
          <p aria-atomic="true" className="sr-only" role="status">
            {examplesAnnouncement}
          </p>
        </section>

        {availability?.status === 'available' && availability.remainingDispatches !== null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t('availability', { count: availability.remainingDispatches })}
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

        {session?.status === 'reviewing' ? (
          <Alert role="status" variant="success">
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{t('reviewReadyTitle')}</AlertTitle>
            <AlertDescription>{t('reviewReadyDescription')}</AlertDescription>
            {/* A traveller who opened this sheet looking for their draft has
                found it. Give them the way back rather than the words alone. */}
            <Button
              nativeButton={false}
              render={<Link href={`/trips/ai/${session.id}`} />}
              size="sm"
              variant="outline"
            >
              {t('reviewReadyAction')}
            </Button>
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
          <Button onClick={refetchAvailability} size="sm" type="button" variant="outline">
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
        {session && (generating || session.status === 'failed') ? (
          <Button
            disabled={operation === 'cancelling'}
            onClick={() => void cancel()}
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" data-icon="inline-start" />
            {operation === 'cancelling'
              ? t('cancelling')
              : session.status === 'failed'
                ? t('startOver')
                : t('cancel')}
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
