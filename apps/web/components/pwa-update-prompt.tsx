'use client';

import { useSerwist } from '@serwist/turbopack/react';
import { RefreshCw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { motionDuration, motionEase } from '@/lib/motion';

/**
 * Surfaces a waiting service worker as an explicit, dismissible update.
 * The worker no longer skips waiting on its own, so this is the only path
 * onto a new build — and the user picks the moment rather than losing
 * whatever they were doing mid-trip.
 */
export function PwaUpdatePrompt() {
  const t = useTranslations('pwaUpdate');
  const { serwist } = useSerwist();
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const acceptedUpdate = useRef(false);

  useEffect(() => {
    if (!serwist) return;

    const onWaiting = () => setUpdateReady(true);
    // `clientsClaim` also fires this on a first install, where reloading would
    // be an unexplained refresh. Only the update the user accepted reloads.
    const onControlling = () => {
      if (acceptedUpdate.current) window.location.reload();
    };
    serwist.addEventListener('waiting', onWaiting);
    serwist.addEventListener('controlling', onControlling);

    // A worker can already be waiting from a previous visit, before this
    // component subscribed to the event.
    void navigator.serviceWorker
      ?.getRegistration()
      .then((registration) => {
        if (registration?.waiting) setUpdateReady(true);
      })
      .catch(() => undefined);

    return () => {
      serwist.removeEventListener('waiting', onWaiting);
      serwist.removeEventListener('controlling', onControlling);
    };
  }, [serwist]);

  return (
    <AnimatePresence>
      {updateReady && !dismissed ? (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          // A notice that arrives from the top on a phone and from the bottom on
          // a desktop cannot share one directional slide, so it fades and settles
          // instead — the same read at either placement.
          className="fixed top-[calc(0.75rem+var(--safe-top))] right-[max(0.75rem,var(--safe-right))] left-[max(0.75rem,var(--safe-left))] z-[calc(var(--layer-notice)+1)] mx-auto max-w-md md:top-auto md:right-[max(1rem,var(--safe-right))] md:bottom-[calc(1rem+var(--safe-bottom))] md:left-auto"
          exit={{ opacity: 0, scale: 0.97 }}
          initial={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: motionDuration.standard, ease: motionEase }}
        >
          <div
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-popover py-2 pr-2 pl-3 text-popover-foreground shadow-[var(--shadow-overlay)]"
            role="status"
          >
            <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <p className="flex-1 truncate text-sm font-medium">{t('title')}</p>
            <Button
              disabled={reloading}
              onClick={() => {
                acceptedUpdate.current = true;
                setReloading(true);
                serwist?.messageSkipWaiting();
              }}
              size="sm"
            >
              {reloading ? t('reloading') : t('reload')}
            </Button>
            <Button
              aria-label={t('later')}
              onClick={() => setDismissed(true)}
              size="icon-sm"
              variant="ghost"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
