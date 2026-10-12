'use client';

import {
  CalendarRange,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  PencilLine,
  ScanSearch,
  Timer,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { AiPlanningAllowance } from '@/components/ai-planning-allowance';
import { AiPlanningBriefField } from '@/components/ai-planning-brief-field';
import { BrandedFallback } from '@/components/media-frame';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { AiPlanningAvailability } from '@/lib/ai-planning/api';
import {
  aiPlanningExampleCategories,
  aiPlanningExampleRotation,
  type AiPlanningExampleId,
} from '@/lib/ai-planning/examples';
import { aiPlanningErrorMessageKey } from '@/lib/ai-planning/presentation';
import type { AiPlanningLifecycle } from '@/lib/ai-planning/use-lifecycle';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const PROMPT_ID = 'ai-planning-prompt';

function retryAtLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/**
 * The brief drawer. It owns the form and nothing else: the run it starts
 * outlives this sheet, so the lifecycle it drives lives in
 * `useAiPlanningLifecycle` above it and arrives here as one object.
 *
 * It opens on one question and a roomy brief. Ideas show while the brief is
 * empty; once the traveller is writing, they give way to how Trove fills the
 * gaps. Setting the trip up by hand stays beside the main action throughout.
 */
export function AiPlanningComposer({
  lifecycle,
  onCreateManually,
}: Readonly<{ lifecycle: AiPlanningLifecycle; onCreateManually: () => void }>) {
  const t = useTranslations('trips.aiPlanning');
  const [examples, setExamples] = useState<readonly AiPlanningExampleId[]>([]);
  const [examplesAnnouncement, setExamplesAnnouncement] = useState('');
  const initializedExamples = useRef(false);
  const {
    availability,
    availabilityError,
    briefSelections,
    canGenerate,
    cancel,
    startOver,
    cancelled,
    composedPrompt,
    generate,
    generating,
    operation,
    prompt,
    refetchAvailability,
    session,
    setBriefSelections,
    setPrompt,
    visibleError,
  } = lifecycle;
  const errorKey = aiPlanningErrorMessageKey(visibleError);
  const busy = operation !== 'idle' || generating;
  // Words decide whether ideas still help; words or choices make a brief.
  const hasWords = prompt.trim().length > 0;
  const hasBrief = composedPrompt.length > 0;
  const exhausted = availability?.status === 'quota_exhausted';
  const unavailable = availability?.status === 'unavailable';
  const failedRun = session?.status === 'failed';

  useEffect(() => {
    // Mounting marks a new opening, including returning from setting up by hand.
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
    <>
      <div className="flex items-center gap-2 px-5 pt-5 pr-16 text-brand">
        <Icons.Ai aria-hidden="true" className="size-4" />
        <SheetTitle className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
          {t('sheetTitle')}
        </SheetTitle>
        <SheetDescription className="sr-only">{t('description')}</SheetDescription>
      </div>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6 sm:px-6">
          {exhausted && availability ? (
            <CreditsSpent availability={availability} />
          ) : unavailable && availability ? (
            <Notice
              icon={<Icons.Warning aria-hidden="true" />}
              title={t(`errors.${aiPlanningErrorMessageKey(availability.code)}`)}
              tone="warning"
            >
              {t('manualFallbackHint')}
            </Notice>
          ) : null}

          {visibleError && !exhausted ? (
            <Notice
              action={
                failedRun ? (
                  <Button
                    className="-ml-3 text-brand hover:text-brand-strong"
                    disabled={operation === 'cancelling'}
                    onClick={() => void startOver()}
                    type="button"
                    variant="ghost"
                  >
                    {operation === 'cancelling' ? t('cancelling') : t('startOver')}
                  </Button>
                ) : null
              }
              icon={<CircleAlert aria-hidden="true" />}
              role="alert"
              title={failedRun ? t('failed.title') : t(`errors.${errorKey}`)}
              tone={session?.status === 'reviewing' ? 'warning' : 'danger'}
            >
              {failedRun ? (
                <>
                  {t(`errors.${errorKey}`)} {t('failed.creditKept')}
                </>
              ) : (
                t('manualFallbackHint')
              )}
            </Notice>
          ) : null}
          {!availability && availabilityError ? (
            <Button onClick={refetchAvailability} size="sm" type="button" variant="outline">
              {t('tryAgain')}
            </Button>
          ) : null}

          {cancelled ? (
            <Notice icon={<CircleCheck aria-hidden="true" />} role="status" tone="neutral">
              {t('cancelled')}
            </Notice>
          ) : null}

          {session?.status === 'reviewing' ? (
            <Notice
              action={
                // A traveller who opened this sheet looking for their draft has
                // found it. Give them the way back rather than the words alone.
                <Button
                  nativeButton={false}
                  render={<Link href={`/trips/ai/${session.id}`} />}
                  size="sm"
                  variant="outline"
                >
                  {t('reviewReadyAction')}
                </Button>
              }
              icon={<CircleCheck aria-hidden="true" />}
              role="status"
              title={t('reviewReadyTitle')}
              tone="success"
            >
              {t('reviewReadyDescription')}
            </Notice>
          ) : null}

          {exhausted ? (
            hasBrief ? (
              <KeptBrief prompt={composedPrompt} />
            ) : null
          ) : (
            <>
              <AiPlanningBriefField
                describedBy={`${PROMPT_ID}-hint`}
                disabled={busy}
                id={PROMPT_ID}
                label={
                  <label
                    className="px-1 font-journal text-[2rem] leading-[1.04] font-normal tracking-[-0.01em] text-balance sm:text-[2.5rem]"
                    htmlFor={PROMPT_ID}
                  >
                    {t('promptLabel')}
                  </label>
                }
                mode="ingredients"
                onSelectionsChange={setBriefSelections}
                onTextChange={setPrompt}
                placeholder={t('promptPlaceholder')}
                selections={briefSelections}
                text={prompt}
              />
              <ul
                className="space-y-1.5 px-1 text-[length:var(--text-metadata)] leading-snug text-muted-foreground"
                id={`${PROMPT_ID}-hint`}
              >
                <li className="flex gap-2">
                  <PencilLine aria-hidden="true" className="mt-px size-4 shrink-0" />
                  {t('promptHint')}
                </li>
                <li className="flex gap-2">
                  <Icons.Saved aria-hidden="true" className="mt-px size-4 shrink-0" />
                  {t('savedPlacesHint')}
                </li>
              </ul>
            </>
          )}

          {!exhausted && !hasWords ? (
            <section aria-labelledby="ai-planning-ideas" className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-sm font-semibold" id="ai-planning-ideas">
                  {t('examplesLabel')}
                </h3>
                <Button
                  className="text-brand hover:text-brand-strong"
                  disabled={busy || examples.length === 0}
                  onClick={showMoreExamples}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t('moreExamples')}
                </Button>
              </div>
              <div className="-mx-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
                {examples.map((example) => (
                  <button
                    className="group/idea flex w-[9.5rem] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card text-left outline-none transition-[border-color,box-shadow] duration-[var(--motion-standard)] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 sm:w-auto"
                    disabled={busy}
                    key={example}
                    onClick={() => {
                      setPrompt(t(`examples.${example}`));
                      document.getElementById(PROMPT_ID)?.focus();
                    }}
                    type="button"
                  >
                    <span className="relative block h-24 w-full">
                      <BrandedFallback alt="" category={aiPlanningExampleCategories[example]} />
                    </span>
                    <span className="flex flex-col gap-1 px-3 pt-2.5 pb-3">
                      <span className="font-journal text-[1.1875rem] leading-[1.08] font-normal">
                        {t(`exampleLabels.${example}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`exampleDetails.${example}`)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p aria-atomic="true" className="sr-only" role="status">
                {examplesAnnouncement}
              </p>
            </section>
          ) : null}

          {!exhausted && hasBrief ? <HowGapsAreFilled /> : null}
        </div>

        <div className="space-y-2.5 border-t border-border-subtle bg-background px-4 pt-3 pb-4 sm:px-6">
          {!exhausted ? (
            <AiPlanningAllowance availability={availability} className="px-1" spending={hasBrief} />
          ) : null}
          <div className="flex gap-2">
            {session && generating ? (
              <Button
                disabled={operation === 'cancelling'}
                onClick={() => void cancel()}
                type="button"
                variant="ghost"
              >
                {operation === 'cancelling' ? t('cancelling') : t('cancel')}
              </Button>
            ) : null}
            {exhausted || unavailable ? (
              <Button className="h-12 flex-1 rounded-full" onClick={onCreateManually} type="button">
                {t('createManually')}
              </Button>
            ) : (
              <>
                <Button
                  className="h-12 rounded-full px-5"
                  disabled={busy}
                  onClick={onCreateManually}
                  type="button"
                  variant="outline"
                >
                  {t('createManually')}
                </Button>
                <Button className="h-12 flex-1 rounded-full" disabled={!canGenerate} type="submit">
                  <Icons.Ai aria-hidden="true" data-icon="inline-start" />
                  {operation === 'starting'
                    ? t('starting')
                    : failedRun
                      ? t('tryAgain')
                      : session
                        ? t('regenerate')
                        : t('generate')}
                </Button>
              </>
            )}
          </div>
        </div>
      </form>
    </>
  );
}

/** A quiet card for what happened, with the next useful step beside it. */
function Notice({
  action,
  children,
  icon,
  role,
  title,
  tone,
}: Readonly<{
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  role?: 'alert' | 'status';
  title?: string;
  tone: 'danger' | 'neutral' | 'success' | 'warning';
}>) {
  return (
    <section
      className={cn(
        'flex gap-3.5 rounded-[var(--radius-xl)] border bg-card p-4',
        tone === 'danger' && 'border-destructive/30',
        tone === 'warning' && 'border-status-warning/35',
        tone === 'success' && 'border-status-success/35',
        tone === 'neutral' && 'border-border-subtle',
      )}
      role={role}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-5',
          tone === 'danger' && 'bg-destructive/10 text-destructive',
          tone === 'warning' && 'bg-status-warning/12 text-status-warning',
          tone === 'success' && 'bg-status-success/12 text-status-success',
          tone === 'neutral' && 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="text-base font-semibold">{title}</p> : null}
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </section>
  );
}

/** Out of credits is a pause, not a dead end: the brief stays, and so does the manual path. */
function CreditsSpent({ availability }: Readonly<{ availability: AiPlanningAvailability }>) {
  const t = useTranslations('trips.aiPlanning');
  const allowance = availability.allowance ?? 0;
  const body = availability.retryAt
    ? t('quotaRetryAt', { retryAt: retryAtLabel(availability.retryAt) })
    : availability.nextRenewalAt
      ? t('creditRenewal', { date: retryAtLabel(availability.nextRenewalAt) })
      : t('quotaRetryUnknown');
  return (
    <section
      aria-labelledby="ai-planning-credits-spent"
      className="space-y-4 rounded-[var(--radius-2xl)] bg-score-media-background p-5 text-score-media-foreground"
      role="status"
    >
      {allowance > 0 && allowance <= 12 ? (
        <div aria-hidden="true" className="flex gap-1.5">
          {Array.from({ length: allowance }, (_, index) => (
            <span className="h-1.5 flex-1 rounded-full bg-score-media-foreground/15" key={index} />
          ))}
        </div>
      ) : null}
      <div className="space-y-1.5">
        {availability.tier ? (
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase">
            {t('noCredits.eyebrow', { tier: t(`tiers.${availability.tier}`) })}
          </p>
        ) : null}
        <h3
          className="font-journal text-[1.875rem] leading-[1.05] font-normal text-balance"
          id="ai-planning-credits-spent"
        >
          {t('noCredits.title')}
        </h3>
        <p className="text-sm leading-relaxed text-score-media-muted">{body}</p>
      </div>
    </section>
  );
}

/** The traveller's words survive running out of credits, ready to copy into notes. */
function KeptBrief({ prompt }: Readonly<{ prompt: string }>) {
  const t = useTranslations('trips.aiPlanning');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <section aria-labelledby="ai-planning-kept-brief" className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold" id="ai-planning-kept-brief">
          {t('noCredits.briefLabel')}
        </h3>
        <Button
          className="text-brand hover:text-brand-strong"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(prompt)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <Copy aria-hidden="true" data-icon="inline-start" />
          <span aria-live="polite">{copied ? t('noCredits.copied') : t('noCredits.copy')}</span>
        </Button>
      </div>
      <p className="rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 py-3.5 text-base leading-relaxed whitespace-pre-wrap">
        {prompt}
      </p>
      <p className="flex gap-2 px-1 pt-1 text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
        <Icons.Create aria-hidden="true" className="mt-px size-4 shrink-0" />
        {t('noCredits.manualHint')}
      </p>
    </section>
  );
}

/** The PRD's assumption rules, said before the tap rather than discovered after it. */
function HowGapsAreFilled() {
  const t = useTranslations('trips.aiPlanning.gaps');
  const rows = [
    { Icon: CalendarRange, key: 'dates' },
    { Icon: Timer, key: 'times' },
    { Icon: ScanSearch, key: 'review' },
  ] as const;
  return (
    <Collapsible className="rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4">
      <CollapsibleTrigger className="group/gaps flex min-h-12 w-full justify-between text-base font-semibold text-foreground hover:text-foreground">
        {t('title')}
        <ChevronDown
          aria-hidden="true"
          className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]/gaps:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="space-y-2.5 pb-4 text-sm leading-relaxed">
          {rows.map(({ Icon, key }) => (
            <li className="flex gap-2.5" key={key}>
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-strong" />
              {t(key)}
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
