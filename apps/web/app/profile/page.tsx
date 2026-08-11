import { getLocale, getTranslations } from 'next-intl/server';
import { ProfileSettingsForm } from '@/components/profile-settings-form';

export default async function ProfilePage() {
  const t = await getTranslations('profile');
  const locale = await getLocale();

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <p className="mb-3 text-sm font-medium tracking-wide text-brand">{t('eyebrow')}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('title')}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          {t('description')}
        </p>
      </div>
      <ProfileSettingsForm locale={locale} />
    </section>
  );
}
