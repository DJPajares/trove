import { getLocale, getTranslations } from 'next-intl/server';

import { AccountSettings, PrivacySecuritySettings } from '@/components/account-settings';
import { PageHeader } from '@/components/page-header';
import { NotificationSettings } from '@/components/notification-settings';
import { OfflineStorageSettings } from '@/components/offline-storage-settings';
import { ProfileSettingsForm } from '@/components/profile-settings-form';
import { Separator } from '@/components/ui/separator';

export default async function ProfilePage() {
  const t = await getTranslations('profile');
  const locale = await getLocale();

  return (
    <section className="mx-auto w-full max-w-5xl space-y-10">
      <PageHeader description={t('description')} title={t('title')} />
      <ProfileSettingsForm locale={locale} />
      <Separator />
      <NotificationSettings />
      <Separator />
      <OfflineStorageSettings />
      <Separator />
      <PrivacySecuritySettings />
      <Separator />
      <AccountSettings />
    </section>
  );
}
