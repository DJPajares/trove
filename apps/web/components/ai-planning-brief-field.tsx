'use client';

import {
  CalendarRange,
  Check,
  ChevronUp,
  Laptop,
  Timer,
  TrainFront,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  aiPlanningBriefIngredients,
  aiPlanningBriefNudges,
  aiPlanningBriefPicks,
  fixedAiPlanningBriefMatcher,
  splitAiPlanningBrief,
  templateAiPlanningBriefMatcher,
  type AiPlanningBriefIngredient,
  type AiPlanningBriefPickIngredient,
  type AiPlanningBriefSelection,
} from '@/lib/ai-planning/brief';
import { AI_PLANNING_PROMPT_MAX_LENGTH } from '@/lib/ai-planning/presentation';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const ingredientIcons: Record<AiPlanningBriefIngredient, LucideIcon> = {
  mustSee: Icons.MustGo,
  pace: Timer,
  travel: TrainFront,
  when: CalendarRange,
  who: Users,
  work: Laptop,
};
const selectionOrder: readonly string[] = [...aiPlanningBriefIngredients, ...aiPlanningBriefNudges];

function isPickIngredient(key: string): key is AiPlanningBriefPickIngredient {
  return Object.hasOwn(aiPlanningBriefPicks, key);
}

/**
 * Every choice the brief can carry, in the traveller's language, and the way
 * back from a composed brief to words and choices. The sentences are the
 * messages themselves, so composing and recognising them can never disagree.
 */
export function useAiPlanningBriefCatalogue() {
  const t = useTranslations('trips.aiPlanning.brief');
  const locale = useLocale();
  return useMemo(() => {
    const pick = (
      key: AiPlanningBriefPickIngredient,
      option: string,
    ): AiPlanningBriefSelection => ({
      key,
      label: t(`picks.${key}.${option}.label`),
      option,
      sentence: t(`picks.${key}.${option}.sentence`),
    });
    const nudge = (key: string): AiPlanningBriefSelection => ({
      key,
      label: t(`nudges.${key}.label`),
      option: key,
      sentence: t(`nudges.${key}.sentence`),
    });
    const dates = (start: string, end: string): AiPlanningBriefSelection => ({
      key: 'when',
      label: t('datesLabel', { end, start }),
      option: 'dates',
      sentence: t('datesSentence', { end, start }),
    });
    const mustSee = (places: string): AiPlanningBriefSelection => ({
      key: 'mustSee',
      label: places,
      option: 'written',
      sentence: t('mustSeeSentence', { places }),
    });
    const dateFormat = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    });
    const matchers = [
      ...(Object.keys(aiPlanningBriefPicks) as AiPlanningBriefPickIngredient[]).flatMap((key) =>
        aiPlanningBriefPicks[key].map((option) => fixedAiPlanningBriefMatcher(pick(key, option))),
      ),
      ...aiPlanningBriefNudges.map((key) => fixedAiPlanningBriefMatcher(nudge(key))),
      templateAiPlanningBriefMatcher(String(t.raw('datesSentence')), ({ end = '', start = '' }) =>
        dates(start, end),
      ),
      templateAiPlanningBriefMatcher(String(t.raw('mustSeeSentence')), ({ places = '' }) =>
        mustSee(places),
      ),
    ];
    return {
      dates,
      formatDate: (isoDate: string) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`)),
      mustSee,
      nudge,
      pick,
      split: (prompt: string) => splitAiPlanningBrief(prompt, matchers),
    };
  }, [locale, t]);
}

const chipClass =
  'h-11 shrink-0 gap-2 rounded-full border-border bg-background px-3.5 text-sm font-semibold shadow-none';
const chipOnClass =
  'border-brand/50 bg-secondary text-secondary-foreground hover:bg-secondary aria-expanded:bg-secondary aria-expanded:text-secondary-foreground aria-pressed:bg-secondary';

/**
 * The traveller's brief: their own words, and choices that travel with them.
 *
 * Tapping an ingredient never writes into the text box. A choice is kept
 * beside the brief, shown on its chip, and sent as a sentence after the
 * traveller's words (PRD 7.6.1: still one free-form prompt). Every choice can be
 * changed in its tray or switched off from its chip.
 */
export function AiPlanningBriefField({
  className,
  describedBy,
  disabled = false,
  id,
  initialTray = null,
  label,
  mode,
  onSelectionsChange,
  onTextChange,
  placeholder,
  selections,
  text,
}: Readonly<{
  className?: string;
  describedBy?: string;
  disabled?: boolean;
  id: string;
  /** Opens one tray straight away, e.g. "When" for a traveller changing dates. */
  initialTray?: AiPlanningBriefIngredient | null;
  label: ReactNode;
  /** `ingredients` helps write a first brief; `nudges` offers quick changes to one. */
  mode: 'ingredients' | 'nudges';
  onSelectionsChange: (selections: AiPlanningBriefSelection[]) => void;
  onTextChange: (text: string) => void;
  placeholder?: string;
  selections: readonly AiPlanningBriefSelection[];
  text: string;
}>) {
  const t = useTranslations('trips.aiPlanning.brief');
  const catalogue = useAiPlanningBriefCatalogue();
  const trayId = useId();
  const [tray, setTray] = useState<AiPlanningBriefIngredient | null>(initialTray);
  const [announcement, setAnnouncement] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [places, setPlaces] = useState(
    () => selections.find((selection) => selection.key === 'mustSee')?.label ?? '',
  );
  const selected = (key: string) => selections.find((selection) => selection.key === key) ?? null;
  // Quick changes lead with When, but any choice the brief already carries is
  // shown too: a choice that is sent must always be one the traveller can see.
  const ingredients: readonly AiPlanningBriefIngredient[] =
    mode === 'ingredients'
      ? aiPlanningBriefIngredients
      : aiPlanningBriefIngredients.filter((key) => key === 'when' || selected(key));

  function choose(key: string, next: AiPlanningBriefSelection | null) {
    const previous = selected(key);
    onSelectionsChange(
      [...selections.filter((selection) => selection.key !== key), ...(next ? [next] : [])].sort(
        (a, b) => selectionOrder.indexOf(a.key) - selectionOrder.indexOf(b.key),
      ),
    );
    setTray(null);
    const name = next ? next.label : previous?.label;
    if (name) setAnnouncement(next ? t('turnedOn', { name }) : t('turnedOff', { name }));
  }

  // Enter inside a tray belongs to the tray, not to the form that plans the trip.
  function keepEnterInTray(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {label}
      <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)] transition-[border-color,box-shadow] duration-[var(--motion-standard)] has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/30">
        <textarea
          aria-describedby={describedBy}
          className="block min-h-28 w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[1.0625rem] leading-relaxed text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          id={id}
          maxLength={AI_PLANNING_PROMPT_MAX_LENGTH}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={placeholder}
          value={text}
        />
        <div className="border-t border-border-subtle pt-2 pb-3">
          <p className="px-5 text-[length:var(--text-metadata)] font-semibold text-muted-foreground">
            {mode === 'ingredients' ? t('addTitle') : t('nudgesTitle')}
          </p>
          <div className="mt-1.5 flex scroll-px-4 gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:flex-wrap">
            {ingredients.map((key) => {
              const Icon = ingredientIcons[key];
              const choice = selected(key);
              const open = tray === key;
              const name = t(`ingredients.${key}`);
              if (!choice) {
                return (
                  <Button
                    aria-controls={trayId}
                    aria-expanded={open}
                    className={cn(chipClass, open && chipOnClass)}
                    disabled={disabled}
                    key={key}
                    onClick={() => setTray(open ? null : key)}
                    type="button"
                    variant="outline"
                  >
                    <Icon
                      aria-hidden="true"
                      className={open ? 'text-current' : 'text-brand'}
                      data-icon="inline-start"
                    />
                    {name}
                    {open ? <ChevronUp aria-hidden="true" data-icon="inline-end" /> : null}
                  </Button>
                );
              }
              return (
                <span
                  className="inline-flex h-11 max-w-[16rem] shrink-0 items-center rounded-full border border-brand/50 bg-secondary text-secondary-foreground"
                  key={key}
                >
                  <button
                    aria-controls={trayId}
                    aria-expanded={open}
                    aria-label={t('chipValue', { ingredient: name, value: choice.label })}
                    className="flex h-full min-w-0 items-center gap-2 rounded-full pr-1 pl-3.5 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => setTray(open ? null : key)}
                    type="button"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{choice.label}</span>
                  </button>
                  <button
                    aria-label={t('remove', { name })}
                    className="grid size-11 shrink-0 place-items-center rounded-full outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => choose(key, null)}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </span>
              );
            })}
            {mode === 'nudges'
              ? aiPlanningBriefNudges.map((key) => {
                  const on = Boolean(selected(key));
                  return (
                    <Button
                      aria-pressed={on}
                      className={cn(chipClass, on && chipOnClass)}
                      disabled={disabled}
                      key={key}
                      onClick={() => choose(key, on ? null : catalogue.nudge(key))}
                      type="button"
                      variant="outline"
                    >
                      {on ? (
                        <Check aria-hidden="true" data-icon="inline-start" />
                      ) : (
                        <Icons.Ai
                          aria-hidden="true"
                          className="text-brand"
                          data-icon="inline-start"
                        />
                      )}
                      {t(`nudges.${key}.label`)}
                    </Button>
                  );
                })
              : null}
          </div>

          {tray ? (
            <div
              aria-labelledby={`${trayId}-title`}
              className="mt-3 space-y-3 border-t border-border-subtle bg-surface-tint px-4 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
              id={trayId}
              onKeyDown={keepEnterInTray}
              role="group"
            >
              <p className="text-sm font-semibold" id={`${trayId}-title`}>
                {t(`trays.${tray}`)}
              </p>
              {isPickIngredient(tray) ? (
                <div className="grid grid-cols-2 gap-2">
                  {aiPlanningBriefPicks[tray].map((option) => {
                    const on = selected(tray)?.option === option;
                    return (
                      <Button
                        aria-pressed={on}
                        className={cn(
                          'h-auto min-h-11 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-semibold whitespace-normal shadow-none',
                          on && chipOnClass,
                        )}
                        key={option}
                        onClick={() => choose(tray, on ? null : catalogue.pick(tray, option))}
                        type="button"
                        variant="outline"
                      >
                        {t(`picks.${tray}.${option}.label`)}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
              {tray === 'when' ? (
                <Collapsible defaultOpen={selected('when')?.option === 'dates'}>
                  <CollapsibleTrigger className="min-h-11 text-brand hover:text-brand-strong">
                    {t('pickDates')}
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Field>
                        <FieldLabel htmlFor={`${trayId}-start`}>{t('startDate')}</FieldLabel>
                        <Input
                          id={`${trayId}-start`}
                          onChange={(event) => setStartDate(event.target.value)}
                          type="date"
                          value={startDate}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${trayId}-end`}>{t('endDate')}</FieldLabel>
                        <Input
                          id={`${trayId}-end`}
                          min={startDate || undefined}
                          onChange={(event) => setEndDate(event.target.value)}
                          type="date"
                          value={endDate}
                        />
                      </Field>
                    </div>
                    <Button
                      className="mt-3"
                      disabled={!startDate || !endDate || endDate < startDate}
                      onClick={() =>
                        choose(
                          'when',
                          catalogue.dates(
                            catalogue.formatDate(startDate),
                            catalogue.formatDate(endDate),
                          ),
                        )
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t('addDates')}
                    </Button>
                  </CollapsiblePanel>
                </Collapsible>
              ) : null}
              {tray === 'mustSee' ? (
                <div className="flex items-end gap-2">
                  <Field className="min-w-0 flex-1">
                    <FieldLabel className="sr-only" htmlFor={`${trayId}-places`}>
                      {t('mustSeeLabel')}
                    </FieldLabel>
                    <Input
                      autoFocus
                      id={`${trayId}-places`}
                      onChange={(event) => setPlaces(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && places.trim())
                          choose('mustSee', catalogue.mustSee(places.trim()));
                      }}
                      placeholder={t('mustSeePlaceholder')}
                      value={places}
                    />
                  </Field>
                  <Button
                    disabled={!places.trim()}
                    onClick={() => choose('mustSee', catalogue.mustSee(places.trim()))}
                    type="button"
                    variant="secondary"
                  >
                    {t('addMustSee')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {selections.length && mode === 'ingredients' ? (
            <p className="mt-2 px-5 text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
              {t('backgroundHint')}
            </p>
          ) : null}
          <p aria-atomic="true" className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </div>
    </div>
  );
}
