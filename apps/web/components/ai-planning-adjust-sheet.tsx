'use client';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FormEvent } from 'react';

import { AiPlanningAllowance } from '@/components/ai-planning-allowance';
import { AiPlanningBriefField } from '@/components/ai-planning-brief-field';
import { journalSerif } from '@/components/memories/journal-font';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { AiPlanningAvailability } from '@/lib/ai-planning/api';
import type { AiPlanningBriefTray } from '@/lib/ai-planning/brief';
import { isAiPlanningPromptValid } from '@/lib/ai-planning/presentation';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const ADJUST_PROMPT_ID = 'ai-review-adjust-prompt';

/**
 * Regenerate, as the same brief drawer the plan started from. The traveller
 * edits their own words or adds a quick change, and the whole trip is planned
 * again from that one prompt; the current draft stays until the new one lands.
 */
export function AiPlanningAdjustSheet({
  availability,
  busy,
  initialTray,
  onOpenChange,
  onSubmit,
  onValueChange,
  open,
  tripName,
  value,
}: Readonly<{
  availability?: AiPlanningAvailability;
  busy: boolean;
  initialTray: AiPlanningBriefTray | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onValueChange: (value: string) => void;
  open: boolean;
  tripName: string;
  value: string;
}>) {
  const t = useTranslations('trips.aiPlanning.review');
  const canSubmit = !busy && isAiPlanningPromptValid(value) && availability?.status === 'available';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className={cn(
          journalSerif.variable,
          'h-[90dvh] w-full gap-3 bg-background md:h-full md:data-[side=right]:w-[min(36rem,calc(100%-0.5rem))]',
        )}
        closeLabel={t('close')}
      >
        <div className="px-5 pt-5 pr-16">
          <SheetTitle className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
            {t('adjustEyebrow')}
          </SheetTitle>
          <SheetDescription className="sr-only">{t('adjustHint')}</SheetDescription>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 sm:px-6">
            <AiPlanningBriefField
              describedBy={`${ADJUST_PROMPT_ID}-hint`}
              disabled={busy}
              id={ADJUST_PROMPT_ID}
              initialTray={initialTray}
              label={
                <div className="space-y-1.5 px-1">
                  <label
                    className="block font-journal text-[2rem] leading-[1.04] font-normal tracking-[-0.01em] text-balance sm:text-[2.5rem]"
                    htmlFor={ADJUST_PROMPT_ID}
                  >
                    {t('adjustLabel')}
                  </label>
                  <p className="text-sm text-muted-foreground" id={`${ADJUST_PROMPT_ID}-hint`}>
                    {t('adjustHint')}
                  </p>
                </div>
              }
              mode="nudges"
              onValueChange={onValueChange}
              value={value}
            />
            <div className="flex gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
              <div className="space-y-0.5">
                <p className="font-semibold">{t('adjustKeepsTitle', { name: tripName })}</p>
                <p className="text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
                  {t('adjustKeepsHint')}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-2.5 border-t border-border-subtle bg-background px-4 pt-3 pb-4 sm:px-6">
            <AiPlanningAllowance availability={availability} className="px-1" spending />
            <div className="flex gap-2">
              <Button
                className="h-12 rounded-full px-5"
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {t('keepPlan')}
              </Button>
              <Button className="h-12 flex-1 rounded-full" disabled={!canSubmit} type="submit">
                <Icons.Ai aria-hidden="true" data-icon="inline-start" />
                {t('planAgain')}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
