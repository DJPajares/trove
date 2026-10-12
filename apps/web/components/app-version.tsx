'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { fetchApiVersion } from '@/lib/updates/api-version';
import { runningRelease } from '@/lib/updates/running-release';

/** A quiet footnote naming the web and API versions this page is talking to. */
export function AppVersion() {
  const t = useTranslations('profile');
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchApiVersion(controller.signal).then((version) => {
      if (!controller.signal.aborted) setApiVersion(version);
    });
    return () => controller.abort();
  }, []);

  return (
    <p className="text-xs leading-5 text-text-subtle tabular-nums">
      {t('appVersion', {
        api: apiVersion ?? t('versionUnknown'),
        web: runningRelease?.version ?? t('versionUnknown'),
      })}
    </p>
  );
}
