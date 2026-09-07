import { getLocale, getTranslations } from 'next-intl/server';

import { AccountSettings, PrivacySecuritySettings } from '@/components/account-settings';
import { PageHeader } from '@/components/page-header';
import { NotificationSettings } from '@/components/notification-settings';
import { OfflineStorageSettings } from '@/components/offline-storage-settings';
import { ProfileSectionNavigation } from '@/components/profile-section-navigation';
import { ProfileSettingsForm } from '@/components/profile-settings-form';

export default async function ProfilePage() {
  const t = await getTranslations('profile');
  const locale = await getLocale();

  return (
    <section className="mx-auto w-full max-w-6xl space-y-10">
      <PageHeader description={t('description')} title={t('title')} />
      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <ProfileSectionNavigation />
        <div className="min-w-0 space-y-6">
          <ProfileSettingsForm locale={locale} />
          <NotificationSettings />
          <OfflineStorageSettings />
          <PrivacySecuritySettings />
          <AccountSettings />
        </div>
      </div>
    </section>
  );
}
