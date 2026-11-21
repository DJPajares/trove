'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { usePreferences } from '@/components/preferences-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

/**
 * Whether other travellers can open this traveller's public view (PRD 8.3).
 *
 * Off until switched on. It saves the moment it is flipped, like a trip's
 * visibility, and only once the server agrees - a profile that is not public
 * must never be shown as if it were. What turning it on shares is said beside
 * the switch, before it is turned on.
 */
export function ProfileVisibilitySettings() {
  const t = useTranslations('profile.visibility');
  const { profile, saveProfileChanges } = usePreferences();
  const online = useOnlineStatus();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const isPublic = profile?.isPublic ?? false;

  async function setPublic(next: boolean) {
    setSaving(true);
    setFailed(false);
    try {
      await saveProfileChanges({ isPublic: next });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      className="scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] gap-0 py-0"
      id="profile-visibility"
    >
      <EditorialSection
        className="p-5 sm:p-6"
        description={t('description')}
        headingId="profile-visibility-heading"
        title={t('title')}
      >
        {failed ? (
          <Alert className="mt-5" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('error')}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-6 flex items-start justify-between gap-5 border-y border-border py-4">
          <span id="profile-public-label">
            <span className="block text-sm font-medium text-foreground">{t('label')}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {!online ? t('offline') : isPublic ? t('onDescription') : t('offDescription')}
            </span>
          </span>
          <Switch
            aria-labelledby="profile-public-label"
            checked={isPublic}
            disabled={saving || !online || !profile}
            onCheckedChange={(checked) => void setPublic(checked)}
          />
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{t('disclosure')}</p>
        {isPublic && profile ? (
          <Link
            className="mt-3 inline-block rounded-[var(--radius-sm)] text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
            href={`/travellers/${encodeURIComponent(profile.id)}`}
          >
            {t('preview')}
          </Link>
        ) : null}
      </EditorialSection>
    </Card>
  );
}
