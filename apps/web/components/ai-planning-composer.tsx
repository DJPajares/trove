'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Copy, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { AiPlanningAllowance, AiPlanningSpendNote } from '@/components/ai-planning-allowance';
import {
  AiPlanningBriefField,
  useAiPlanningBriefCatalogue,
} from '@/components/ai-planning-brief-field';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SheetHeading } from '@/components/ui/sheet';
import type { AiPlanningAvailability } from '@/lib/ai-planning/api';
import { AI_PLANNING_FINDS_KEY, type AiPlanningBriefSelection } from '@/lib/ai-planning/brief';
import {
  aiPlanningExampleCategories,
  aiPlanningExamplePicks,
  aiPlanningExampleRotation,
  type AiPlanningExampleId,
} from '@/lib/ai-planning/examples';
import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { aiPlanningErrorMessageKey } from '@/lib/ai-planning/presentation';
import type { AiPlanningLifecycle } from '@/lib/ai-planning/use-lifecycle';
import * as Icons from '@/lib/icons';
import { queryKeys } from '@/lib/query/keys';
import { fetchSavedPlaces } from '@/lib/saved/api';
import { cn } from '@/lib/utils';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

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
 * It opens on one question and a roomy brief, with ideas to start from that
 * stay on show (the one in use is marked) and a way to start fresh. Setting the
 * trip up by hand stays beside the main action throughout.
 */
export function AiPlanningComposer({
  lifecycle,
  onCreateManually,
}: Readonly<{ lifecycle: AiPlanningLifecycle; onCreateManually: () => void }>) {
  const t = useTranslations('trips.aiPlanning');
  const [examples, setExamples] = useState<readonly AiPlanningExampleId[]>([]);
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
  // Words or choices make a brief. Ideas stay on show either way, so the one a
  // brief started from can always be found again, or swapped for another.
  const hasBrief = composedPrompt.length > 0;
  const exhausted = availability?.status === 'quota_exhausted';
  const unavailable = availability?.status === 'unavailable';
  const failedRun = session?.status === 'failed';

  useEffect(() => {
    // Each opening rotates to new ideas while the brief is empty. A brief that
    // started from an idea reopens beside that idea; Strict Mode's replay must
    // not consume a second set.
    if (initializedExamples.current) return;
    initializedExamples.current = true;
    const words = prompt.trim();
    const inUse =
      (Object.keys(aiPlanningExampleCategories) as AiPlanningExampleId[]).find(
        (id) => words && t(`examples.${id}`) === words,
      ) ?? null;
    setExamples(aiPlanningExampleRotation.forOpening({ hasBrief, inUse }));
    // Read once per opening, from the brief as it stood when the drawer opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void generate();
  }

  return (
    <>
      <SheetHeading description={t('description')} title={t('sheetTitle')} />

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <ScrollShadow className="flex-1 space-y-5 px-4 pt-2 pb-6 sm:px-6">
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
                  <label className="sr-only" htmlFor={PROMPT_ID}>
                    {t('promptLabel')}
                  </label>
                }
                maxDays={availability?.maxItineraryDays ?? null}
                mode="ingredients"
                onSelectionsChange={setBriefSelections}
                onTextChange={setPrompt}
                placeholder={t('promptPlaceholder')}
                selections={briefSelections}
                text={prompt}
              />
              <div className="-mt-2 flex items-center justify-between gap-3 px-1">
                <p
                  className="text-[length:var(--text-metadata)] leading-snug text-muted-foreground"
                  id={`${PROMPT_ID}-hint`}
                >
                  {t('promptHint')}
                </p>
                {/* Clears the words, every option and the kept copy, for a
                    fresh start. Ideas stay below to start again from. */}
                {hasBrief ? (
                  <Button
                    className="-my-1 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={() => {
                      void startOver();
                      document.getElementById(PROMPT_ID)?.focus();
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" data-icon="inline-start" />
                    {t('startFresh')}
                  </Button>
                ) : null}
              </div>
              <FindsSwitch
                disabled={busy}
                onChange={setBriefSelections}
                selections={briefSelections}
              />
            </>
          )}

          {!exhausted && examples.length ? (
            <IdeaCards
              current={prompt}
              disabled={busy}
              examples={examples}
              onUse={(text, selections) => {
                setPrompt(text);
                setBriefSelections(selections);
                document.getElementById(PROMPT_ID)?.focus();
              }}
            />
          ) : null}
        </ScrollShadow>

        <div className="space-y-2.5 border-t border-border-subtle bg-background px-4 pt-3 pb-4 sm:px-6">
          {!exhausted ? <AiPlanningAllowance availability={availability} className="px-1" /> : null}
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
          {!exhausted && !unavailable && hasBrief && canGenerate ? (
            <AiPlanningSpendNote availability={availability} className="px-1 text-end" />
          ) : null}
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

/** Each idea's category colour on its small glyph; every class written whole for Tailwind. */
const IDEA_TINTS: Record<TrovePlaceCategory, string> = {
  destination: 'text-brand',
  food_and_drink: 'text-category-food',
  other: 'text-category-other',
  shopping: 'text-category-shopping',
  stay: 'text-category-stay',
  things_to_do: 'text-category-activities',
  transport: 'text-category-transport',
};

/**
 * Ideas to start from, kept small and quiet so they read as suggestions beside
 * the brief rather than part of it. Using one fills the brief with its words
 * and turns on the same options a traveller would pick, so every chip stays
 * editable. Who and pace are read out with the name.
 */
function IdeaCards({
  current,
  disabled,
  examples,
  onUse,
}: Readonly<{
  /** The brief's words, so the idea it came from stays marked. */
  current: string;
  disabled: boolean;
  examples: readonly AiPlanningExampleId[];
  onUse: (text: string, selections: AiPlanningBriefSelection[]) => void;
}>) {
  const t = useTranslations('trips.aiPlanning');
  const catalogue = useAiPlanningBriefCatalogue();

  function selectionsFor(example: AiPlanningExampleId) {
    const picks = aiPlanningExamplePicks[example];
    const who =
      typeof picks.who === 'string'
        ? catalogue.pick('who', picks.who)
        : catalogue.group(picks.who.group, picks.who.count);
    const mustSeeKey = `exampleMustSees.${example}`;
    return [
      catalogue.pick('when', picks.when),
      who,
      catalogue.pick('pace', picks.pace),
      ...(t.has(mustSeeKey) ? [catalogue.mustSee(t(mustSeeKey))] : []),
      ...(picks.rhythm ? [catalogue.pick('rhythm', picks.rhythm)] : []),
    ];
  }

  return (
    <section aria-labelledby="ai-planning-ideas" className="space-y-2">
      <h3
        className="px-1 text-[length:var(--text-metadata)] font-semibold text-muted-foreground"
        id="ai-planning-ideas"
      >
        {t('examplesLabel')}
      </h3>
      <ScrollShadow
        className="-mx-4 flex gap-2 px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
        orientation="horizontal"
      >
        {examples.map((example) => {
          const selections = selectionsFor(example);
          const label = t(`exampleLabels.${example}`);
          const meta = [selections[1]!.label, selections[2]!.label].join(' · ');
          const category = aiPlanningExampleCategories[example];
          const { Icon } = resolvePlaceCategoryFallback(category);
          const inUse = current.trim() === t(`examples.${example}`);
          return (
            <button
              aria-label={t('exampleUse', { label, meta })}
              aria-pressed={inUse}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border-subtle px-3 text-sm font-medium text-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:border-border hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 aria-pressed:border-brand/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground motion-reduce:transition-none"
              disabled={disabled}
              key={example}
              onClick={() => onUse(t(`examples.${example}`), selections)}
              title={meta}
              type="button"
            >
              <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', IDEA_TINTS[category])} />
              {label}
            </button>
          );
        })}
      </ScrollShadow>
    </section>
  );
}

/**
 * The traveller's saved finds go into every plan where they fit (PRD 7.6); this
 * makes that visible and lets them leave the finds out of this one. Off is sent
 * as a sentence with the brief, like any other choice. Hidden with no finds.
 */
function FindsSwitch({
  disabled,
  onChange,
  selections,
}: Readonly<{
  disabled: boolean;
  onChange: (selections: AiPlanningBriefSelection[]) => void;
  selections: readonly AiPlanningBriefSelection[];
}>) {
  const t = useTranslations('trips.aiPlanning.brief');
  const catalogue = useAiPlanningBriefCatalogue();
  const saved = useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() });
  const count = saved.data?.savedPlaces.length ?? 0;
  if (!count) return null;
  const on = !selections.some((selection) => selection.key === AI_PLANNING_FINDS_KEY);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 py-3">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-surface-tint text-brand"
      >
        <Icons.Saved className="size-[1.125rem]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t('findsTitle', { count })}</span>
        <span className="block text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
          {t('findsHint')}
        </span>
      </span>
      <Switch
        checked={on}
        disabled={disabled}
        onCheckedChange={(checked) =>
          onChange(
            checked
              ? selections.filter((selection) => selection.key !== AI_PLANNING_FINDS_KEY)
              : [...selections, catalogue.findsOff],
          )
        }
      />
    </label>
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
        {availability.status === 'quota_exhausted' ? (
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase">
            {t('noCredits.eyebrow')}
          </p>
        ) : null}
        <h3
          className="font-journal text-[1.875rem] leading-[1.05] font-normal text-balance"
          id="ai-planning-credits-spent"
        >
          {t('noCredits.title', { count: allowance })}
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
