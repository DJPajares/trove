import { getLocale, getTranslations } from 'next-intl/server';

import { AccountSettings, PrivacySecuritySettings } from '@/components/account-settings';
import { AppVersion } from '@/components/app-version';
import { journalSerif } from '@/components/memories/journal-font';
import { PageHeader } from '@/components/page-header';
import { NotificationSettings } from '@/components/notification-settings';
import { OfflineStorageSettings } from '@/components/offline-storage-settings';
import { ProfileSettingsForm } from '@/components/profile-settings-form';

export default async function SettingsPage() {
  const t = await getTranslations('profile');
  const locale = await getLocale();

  return (
    <div className={journalSerif.variable}>
      <section className="mx-auto w-full max-w-3xl space-y-7">
        <PageHeader
          description={t('description')}
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleFont="journal"
        />
        <div className="space-y-6">
          <ProfileSettingsForm locale={locale} />
          <NotificationSettings />
          <OfflineStorageSettings />
          <PrivacySecuritySettings />
          <AccountSettings />
          <AppVersion />
        </div>
      </section>
    </div>
  );
}
