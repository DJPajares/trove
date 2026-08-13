'use client';

import { Bell, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useNotifications } from '@/components/notifications-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

type PermissionState = 'denied' | 'granted' | 'prompt' | 'unsupported';

function browserPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export function NotificationSettings() {
  const t = useTranslations('notifications.settings');
  const { settings, status, updateSettings } = useNotifications();
  const [saving, setSaving] = useState<'browser' | 'enabled' | null>(null);
  const [error, setError] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('prompt');

  useEffect(() => {
    setPermission(browserPermission());
  }, []);

  async function setEnabled(enabled: boolean) {
    setError(false);
    setSaving('enabled');
    try {
      await updateSettings({ enabled });
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
        if (typeof Notification === 'undefined') {
          setPermission('unsupported');
          return;
        }
        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
        if (nextPermission !== 'granted') return;
      }
      await updateSettings({ browserEnabled: enabled });
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="gap-0 py-0" id="notifications">
      <section aria-labelledby="notification-settings-heading" className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Bell aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <h2
              className="text-lg leading-6 font-semibold tracking-tight"
              id="notification-settings-heading"
            >
              {t('title')}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        {error || status === 'error' ? (
          <Alert className="mt-5" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('saveError')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 border-y border-border">
          <label
            className="flex cursor-pointer items-start justify-between gap-5 py-4"
            htmlFor="trove-notifications-enabled"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">{t('inAppLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t('inAppDescription')}
              </span>
            </span>
            <Switch
              checked={settings.enabled}
              disabled={saving !== null || status === 'loading' || status === 'unavailable'}
              id="trove-notifications-enabled"
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </label>

          <label
            className="flex cursor-pointer items-start justify-between gap-5 border-t border-border py-4"
            htmlFor="trove-browser-notifications-enabled"
          >
            <span>
              <span className="block text-sm font-medium text-foreground">{t('browserLabel')}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {permission === 'denied'
                  ? t('permissionDenied')
                  : permission === 'unsupported'
                    ? t('unsupported')
                    : t('browserDescription')}
              </span>
            </span>
            <Switch
              checked={settings.browserEnabled && permission === 'granted'}
              disabled={!settings.enabled || saving !== null || permission === 'unsupported'}
              id="trove-browser-notifications-enabled"
              onCheckedChange={(checked) => void setBrowserEnabled(checked)}
            />
          </label>
        </div>

        <p className="mt-4 text-xs leading-5 text-text-subtle">{t('privacyNote')}</p>
      </section>
    </Card>
  );
}
