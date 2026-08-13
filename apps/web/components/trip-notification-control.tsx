'use client';

import { BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useNotifications } from '@/components/notifications-provider';
import { Switch } from '@/components/ui/switch';
import {
  fetchTripNotificationPreference,
  saveTripNotificationPreference,
} from '@/lib/notifications/api';

export function TripNotificationControl({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('notifications.trip');
  const { refresh, settings } = useNotifications();
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<'error' | 'loading' | 'ready' | 'saving'>('loading');

  useEffect(() => {
    let active = true;
    void fetchTripNotificationPreference(tripId)
      .then(({ preference }) => {
        if (!active) return;
        setMuted(preference.muted);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [tripId]);

  async function setEnabled(enabled: boolean) {
    const previous = muted;
    setMuted(!enabled);
    setStatus('saving');
    try {
      const { preference } = await saveTripNotificationPreference(tripId, !enabled);
      setMuted(preference.muted);
      setStatus('ready');
      await refresh();
    } catch {
      setMuted(previous);
      setStatus('error');
    }
  }

  return (
    <section aria-labelledby="trip-notifications-heading" className="border-y border-border py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <BellOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div>
            <h3 className="text-base font-semibold" id="trip-notifications-heading">
              {t('title')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {settings.enabled ? t('description') : t('globallyDisabled')}
            </p>
          </div>
        </div>
        <Switch
          aria-label={t('toggleLabel')}
          checked={!muted}
          disabled={status === 'loading' || status === 'saving'}
          onCheckedChange={(checked) => void setEnabled(checked)}
        />
      </div>
      {status === 'error' ? (
        <p className="mt-2 text-xs leading-5 text-destructive" role="alert">
          {t('saveError')}
        </p>
      ) : null}
    </section>
  );
}
