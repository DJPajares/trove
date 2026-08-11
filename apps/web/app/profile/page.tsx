import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { ProfileSettingsForm } from '@/components/profile-settings-form';

export default async function ProfilePage() {
  const t = await getTranslations('profile');
  const locale = await getLocale();

  return (
    <section className="mx-auto w-full max-w-5xl space-y-10">
      <PageHeader description={t('description')} eyebrow={t('eyebrow')} title={t('title')} />
      <ProfileSettingsForm locale={locale} />
    </section>
  );
}
