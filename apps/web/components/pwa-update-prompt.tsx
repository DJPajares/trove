'use client';

import { ChevronDown, RefreshCw, X } from 'lucide-react';
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
    <Collapsible className="px-3 pb-2">
      <CollapsibleTrigger>
        {t('whatsNew')}
        <ChevronDown
          aria-hidden="true"
          className="transition-transform duration-[var(--motion-standard)] in-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="max-h-[40dvh] overflow-y-auto overscroll-contain pt-2 pb-1">
          <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">
            {shown.map((summary) => (
              <li key={summary.id}>{summary.text}</li>
            ))}
          </ul>
          {summaries.length > 5 ? (
            <Button
              className="mt-2"
              onClick={() => setShowAll((previous) => !previous)}
              size="sm"
              variant="ghost"
            >
              {showAll ? t('showLess') : t('showMore', { count: summaries.length - 5 })}
            </Button>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
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
          animate={{ opacity: 1, scale: 1 }}
          className="fixed top-[calc(0.75rem+var(--safe-top))] right-[max(0.75rem,var(--safe-right))] left-[max(0.75rem,var(--safe-left))] z-[calc(var(--layer-notice)+1)] mx-auto max-w-md md:top-auto md:right-[max(1rem,var(--safe-right))] md:bottom-[calc(1rem+var(--safe-bottom))] md:left-auto"
          exit={{ opacity: 0, scale: 0.97 }}
          initial={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: motionDuration.standard, ease: motionEase }}
        >
          <div className="rounded-[var(--radius-md)] border border-border-subtle bg-popover text-popover-foreground shadow-[var(--shadow-overlay)]">
            <div className="flex items-center gap-2 py-2 pr-2 pl-3">
              <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-brand" />
              <p className="flex-1 truncate text-sm font-medium" role="status">
                {t('title')}
              </p>
              <Button disabled={update.reloading} onClick={() => void update.reload()} size="sm">
                {update.reloading ? t('reloading') : t('reload')}
              </Button>
              <Button
                aria-label={t('later')}
                disabled={update.reloading}
                onClick={update.dismiss}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            {summaries.length ? (
              <UpdateDetails key={update.waiting?.generation} summaries={summaries} />
            ) : null}
            {update.reloadError ? (
              <p className="px-3 pb-3 text-sm text-muted-foreground" role="alert">
                {t('reloadError')}
              </p>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
