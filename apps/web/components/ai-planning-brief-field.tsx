'use client';

import {
  CalendarRange,
  Check,
  ChevronUp,
  Laptop,
  Timer,
  TrainFront,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  aiPlanningBriefNudges,
  aiPlanningBriefPicks,
  aiPlanningBriefStarters,
  appendToAiPlanningBrief,
  type AiPlanningBriefTray,
} from '@/lib/ai-planning/brief';
import { AI_PLANNING_PROMPT_MAX_LENGTH } from '@/lib/ai-planning/presentation';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const trayIcons: Record<AiPlanningBriefTray, LucideIcon> = {
  pace: Timer,
  when: CalendarRange,
  who: Users,
};
const starterIcons = { mustSee: Icons.MustGo, travel: TrainFront, work: Laptop } as const;

type LastAddition = { key: string; previous: string; result: string; sentence: string };

type Chip =
  | { icon: LucideIcon; key: AiPlanningBriefTray; kind: 'tray'; label: string }
  | { icon: LucideIcon; key: string; kind: 'sentence'; label: string; open: boolean; text: string };

const chipClass =
  'h-11 shrink-0 gap-2 rounded-full border-border bg-background px-3.5 text-sm font-semibold shadow-none';
const chipActiveClass =
  'border-brand/60 bg-secondary text-secondary-foreground hover:bg-secondary aria-expanded:bg-secondary aria-expanded:text-secondary-foreground';

/**
 * The traveller's brief: one free-form prompt, with helpers that write into it.
 *
 * Every helper adds a plain sentence the traveller can read, edit or undo, so
 * the request stays exactly their own words (PRD 7.6.1). A chip shows a tick
 * only once it has been used; nothing here guesses from the text what the
 * brief already covers.
 */
export function AiPlanningBriefField({
  className,
  describedBy,
  disabled = false,
  id,
  initialTray = null,
  label,
  mode,
  onValueChange,
  placeholder,
  value,
}: Readonly<{
  className?: string;
  describedBy?: string;
  disabled?: boolean;
  id: string;
  /** Opens one tray straight away, e.g. "When" for a traveller changing dates. */
  initialTray?: AiPlanningBriefTray | null;
  label: ReactNode;
  /** `ingredients` helps write a first brief; `nudges` offers quick changes to one. */
  mode: 'ingredients' | 'nudges';
  onValueChange: (value: string) => void;
  placeholder?: string;
  value: string;
}>) {
  const t = useTranslations('trips.aiPlanning.brief');
  const locale = useLocale();
  const trayId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tray, setTray] = useState<AiPlanningBriefTray | null>(initialTray);
  const [used, setUsed] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<LastAddition | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // A cleared brief is a fresh start, so no helper should still claim a tick.
  useEffect(() => {
    if (value.trim()) return;
    setUsed(new Set());
    setLast(null);
  }, [value]);

  const chips: Chip[] =
    mode === 'ingredients'
      ? [
          ...(Object.keys(aiPlanningBriefPicks) as AiPlanningBriefTray[]).map((key) => ({
            icon: trayIcons[key],
            key,
            kind: 'tray' as const,
            label: t(`ingredients.${key}`),
          })),
          ...aiPlanningBriefStarters.map((key) => ({
            icon: starterIcons[key],
            key,
            kind: 'sentence' as const,
            label: t(`ingredients.${key}`),
            open: true,
            text: t(`starters.${key}`),
          })),
        ]
      : [
          { icon: trayIcons.when, key: 'when', kind: 'tray', label: t('ingredients.when') },
          ...aiPlanningBriefNudges.map((key) => ({
            icon: Icons.Ai,
            key,
            kind: 'sentence' as const,
            label: t(`nudges.${key}.label`),
            open: false,
            text: t(`nudges.${key}.sentence`),
          })),
        ];

  function add(key: string, sentence: string, open = false) {
    const next = appendToAiPlanningBrief(value, sentence, { open });
    if (next === null) {
      setAnnouncement(t('full'));
      return;
    }
    setLast({ key, previous: value, result: next, sentence: sentence.trim() });
    setUsed((current) => new Set(current).add(key));
    setTray(null);
    onValueChange(next);
    setAnnouncement(t('added', { sentence: sentence.trim() }));
    if (open) {
      // A starter is half a sentence: hand the caret back so typing finishes it.
      window.requestAnimationFrame(() => {
        const field = textareaRef.current;
        if (!field) return;
        field.focus();
        field.setSelectionRange(next.length, next.length);
      });
    }
  }

  function addDates() {
    if (!startDate || !endDate || endDate < startDate) return;
    const format = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    });
    add(
      'when',
      t('datesSentence', {
        end: format.format(new Date(`${endDate}T00:00:00Z`)),
        start: format.format(new Date(`${startDate}T00:00:00Z`)),
      }),
    );
    setStartDate('');
    setEndDate('');
  }

  function undo() {
    if (!last || value !== last.result) return;
    onValueChange(last.previous);
    setUsed((current) => {
      const next = new Set(current);
      next.delete(last.key);
      return next;
    });
    setAnnouncement(t('removed', { sentence: last.sentence }));
    setLast(null);
  }

  const canUndo = Boolean(last && value === last.result && !tray);

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
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          ref={textareaRef}
          value={value}
        />
        <div className="border-t border-border-subtle pt-2 pb-3">
          <p className="px-5 text-[length:var(--text-metadata)] font-semibold text-muted-foreground">
            {mode === 'ingredients' ? t('addTitle') : t('nudgesTitle')}
          </p>
          <div className="mt-1.5 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:flex-wrap">
            {chips.map((chip) => {
              const open = chip.kind === 'tray' && tray === chip.key;
              const isUsed = used.has(chip.key);
              const Icon = isUsed ? Check : chip.icon;
              return (
                <Button
                  aria-controls={chip.kind === 'tray' ? trayId : undefined}
                  aria-expanded={chip.kind === 'tray' ? open : undefined}
                  className={cn(chipClass, (open || isUsed) && chipActiveClass)}
                  disabled={disabled}
                  key={chip.key}
                  onClick={() => {
                    if (chip.kind === 'tray') setTray(open ? null : chip.key);
                    else add(chip.key, chip.text, chip.open);
                  }}
                  type="button"
                  variant="outline"
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(open || isUsed ? 'text-current' : 'text-brand')}
                    data-icon="inline-start"
                  />
                  {chip.label}
                  {open ? <ChevronUp aria-hidden="true" data-icon="inline-end" /> : null}
                </Button>
              );
            })}
          </div>

          {tray ? (
            <div
              aria-labelledby={`${trayId}-title`}
              className="mt-3 space-y-3 border-t border-border-subtle bg-surface-tint px-4 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
              id={trayId}
              role="group"
            >
              <p className="text-sm font-semibold" id={`${trayId}-title`}>
                {t(`trays.${tray}`)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {aiPlanningBriefPicks[tray].map((pick) => (
                  <Button
                    className="h-auto min-h-11 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-semibold whitespace-normal shadow-none"
                    key={pick}
                    onClick={() => add(tray, t(`picks.${tray}.${pick}.sentence`))}
                    type="button"
                    variant="outline"
                  >
                    {t(`picks.${tray}.${pick}.label`)}
                  </Button>
                ))}
              </div>
              {tray === 'when' ? (
                <Collapsible>
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
                      onClick={addDates}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t('addDates')}
                    </Button>
                  </CollapsiblePanel>
                </Collapsible>
              ) : null}
            </div>
          ) : null}

          {canUndo && last ? (
            <div className="mt-2 flex items-center gap-2 pr-2 pl-5">
              <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />
              <p className="min-w-0 flex-1 text-[length:var(--text-metadata)] leading-snug">
                {t('added', { sentence: last.sentence })}
              </p>
              <Button
                className="text-brand hover:text-brand-strong"
                onClick={undo}
                type="button"
                variant="ghost"
              >
                {t('undo')}
              </Button>
            </div>
          ) : null}
          <p aria-atomic="true" className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      </div>
    </div>
  );
}
