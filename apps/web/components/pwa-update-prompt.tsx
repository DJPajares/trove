'use client';

import { ChevronDown, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { motionDuration, motionEase } from '@/lib/motion';
import { unseenSummaries } from '@/lib/updates/release';
import { runningRelease, useAppUpdate } from '@/lib/updates/use-app-update';

function UpdateDetails({ summaries }: { summaries: { id: string; text: string }[] }) {
  const t = useTranslations('pwaUpdate');
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? summaries : summaries.slice(0, 5);

  return (
    <CollapsiblePanel>
      <div className="mx-4 border-t border-border-subtle">
        <div className="max-h-[40dvh] overflow-y-auto overscroll-contain py-3">
          <ul className="list-disc space-y-2.5 pr-1 pl-4 text-sm leading-relaxed text-muted-foreground marker:text-border-strong">
            {shown.map((summary) => (
              <li key={summary.id}>{summary.text}</li>
            ))}
          </ul>
          {summaries.length > 5 ? (
            <Button
              className="mt-2 min-h-11 max-w-full whitespace-normal"
              onClick={() => setShowAll((previous) => !previous)}
              size="sm"
              variant="ghost"
            >
              {showAll ? t('showLess') : t('showMore', { count: summaries.length - 5 })}
            </Button>
          ) : null}
        </div>
      </div>
    </CollapsiblePanel>
  );
}

/** Details belong to the waiting worker; activation remains an explicit traveller action. */
export function PwaUpdatePrompt() {
  const t = useTranslations('pwaUpdate');
  const locale = useLocale();
  const update = useAppUpdate();
  const summaries = update.waiting?.release
    ? unseenSummaries(update.waiting.release, runningRelease, update.installedIds, locale)
    : [];

  return (
    <AnimatePresence>
      {update.visible ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed top-[calc(0.75rem+var(--safe-top))] right-[max(0.75rem,var(--safe-right))] left-[max(0.75rem,var(--safe-left))] z-[calc(var(--layer-notice)+1)] mx-auto max-w-[25rem] md:top-auto md:right-[max(1rem,var(--safe-right))] md:bottom-[calc(1rem+var(--safe-bottom))] md:left-auto md:w-[25rem]"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: motionDuration.standard, ease: motionEase }}
        >
          <Collapsible
            key={update.waiting?.generation}
            className="rounded-[var(--radius-md)] border border-border-subtle bg-popover text-popover-foreground shadow-[var(--shadow-overlay)]"
          >
            <p className="sr-only" role="status">
              {t('title')}
            </p>
            <div className="flex flex-wrap items-center gap-1 p-2">
              {summaries.length ? (
                <CollapsibleTrigger className="min-h-11 min-w-28 flex-1 flex-col items-start justify-center gap-0.5 px-2 py-1 text-left hover:bg-surface-hover">
                  <span className="text-sm leading-5 text-popover-foreground">{t('title')}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-normal leading-4">
                    {t('whatsNew')}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-3 transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] in-data-panel-open:rotate-180 motion-reduce:transition-none"
                    />
                  </span>
                </CollapsibleTrigger>
              ) : (
                <p className="min-w-28 flex-1 px-2 py-1 text-sm leading-5 font-medium">
                  {t('title')}
                </p>
              )}
              <Button
                className="h-auto min-h-11 min-w-22 max-w-full px-3 py-2 whitespace-normal"
                disabled={update.reloading}
                onClick={() => void update.reload()}
                size="sm"
              >
                {update.reloading ? t('reloading') : t('reload')}
              </Button>
              <Button
                aria-label={t('later')}
                disabled={update.reloading}
                onClick={update.dismiss}
                className="text-muted-foreground"
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {summaries.length ? <UpdateDetails summaries={summaries} /> : null}
            {update.reloadError ? (
              <p className="px-4 pb-3 text-sm leading-relaxed text-muted-foreground" role="alert">
                {t('reloadError')}
              </p>
            ) : null}
          </Collapsible>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
