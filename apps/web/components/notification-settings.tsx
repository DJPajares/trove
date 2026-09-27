'use client';

import { Bell, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { useNotifications } from '@/components/notifications-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  backgroundPushStatus,
  clearLocalPush,
  disableBackgroundPush,
  enableBackgroundPush,
  type BackgroundPushStatus,
} from '@/lib/notifications/push';

export function NotificationSettings() {
  const t = useTranslations('notifications.settings');
  const { refresh, settings, status, updateSettings } = useNotifications();
  const [saving, setSaving] = useState<'browser' | 'enabled' | null>(null);
  const [error, setError] = useState(false);
  const [pushStatus, setPushStatus] = useState<BackgroundPushStatus>('off');

  useEffect(() => {
    void backgroundPushStatus(settings.browserEnabled).then(setPushStatus);
  }, [settings.browserEnabled]);

  async function setEnabled(enabled: boolean) {
    setError(false);
    setSaving('enabled');
    try {
      await updateSettings({ enabled });
      if (!enabled) {
        await clearLocalPush();
        setPushStatus('off');
      }
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  async function setBrowserEnabled(enabled: boolean) {
    setError(false);
    setSaving('browser');
    try {
      if (enabled) {
        await enableBackgroundPush(settings.browserEnabled);
      } else {
        await disableBackgroundPush();
      }
      await refresh();
      setPushStatus(await backgroundPushStatus(enabled));
    } catch {
      setError(true);
      setPushStatus(
        await backgroundPushStatus(settings.browserEnabled).catch(() => 'unavailable' as const),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card
      className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
      id="notifications"
    >
      <EditorialSection
        className="p-5 sm:p-6"
        description={t('description')}
        headingId="notification-settings-heading"
        icon={<Bell aria-hidden="true" />}
        title={t('title')}
      >
        {error || status === 'error' ? (
          <Alert className="mt-5" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('saveError')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 border-y border-border">
          <div className="flex items-start justify-between gap-5 py-4">
            <span id="trove-notifications-enabled-label">
              <span className="block text-sm font-medium text-foreground">{t('inAppLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t('inAppDescription')}
              </span>
            </span>
            <Switch
              aria-labelledby="trove-notifications-enabled-label"
              checked={settings.enabled}
              disabled={saving !== null || status === 'loading' || status === 'unavailable'}
              id="trove-notifications-enabled"
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </div>

          <div className="flex items-start justify-between gap-5 border-t border-border py-4">
            <span id="trove-browser-notifications-enabled-label">
              <span className="block text-sm font-medium text-foreground">{t('browserLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {pushStatus === 'denied'
                  ? t('permissionDenied')
                  : pushStatus === 'unsupported'
                    ? t('unsupported')
                    : pushStatus === 'unavailable'
                      ? t('unavailable')
                      : pushStatus === 'configured'
                        ? t('configured')
                        : t('browserDescription')}
              </span>
            </span>
            <Switch
              aria-labelledby="trove-browser-notifications-enabled-label"
              checked={pushStatus === 'configured'}
              disabled={
                !settings.enabled ||
                saving !== null ||
                pushStatus === 'unsupported' ||
                pushStatus === 'unavailable' ||
                pushStatus === 'denied'
              }
              id="trove-browser-notifications-enabled"
              onCheckedChange={(checked) => void setBrowserEnabled(checked)}
            />
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-text-subtle">{t('privacyNote')}</p>
      </EditorialSection>
    </Card>
  );
}
