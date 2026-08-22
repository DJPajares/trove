'use client';

import { useSerwist } from '@serwist/turbopack/react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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

  if (!updateReady || dismissed) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--bottom-bar-height)+var(--safe-bottom)+0.75rem)] z-[var(--layer-overlay)] mx-auto max-w-md sm:inset-x-auto sm:right-4 md:bottom-[calc(1rem+var(--safe-bottom))]">
      <Alert aria-live="polite" className="bg-popover shadow-[var(--shadow-overlay)]">
        <RefreshCw aria-hidden="true" />
        <AlertTitle>{t('title')}</AlertTitle>
        <AlertDescription>{t('description')}</AlertDescription>
        <AlertAction className="gap-2">
          <Button onClick={() => setDismissed(true)} size="xs" variant="ghost">
            {t('later')}
          </Button>
          <Button
            disabled={reloading}
            onClick={() => {
              acceptedUpdate.current = true;
              setReloading(true);
              serwist?.messageSkipWaiting();
            }}
            size="xs"
          >
            {reloading ? t('reloading') : t('reload')}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
