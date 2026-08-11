import { UserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PagePlaceholder } from '@/components/page-placeholder';

export default async function ProfilePage() {
  const t = await getTranslations('placeholder');

  return (
    <PagePlaceholder
      description={t('profile.description')}
      eyebrow={t('eyebrow')}
      icon={<UserRound aria-hidden="true" className="size-6" />}
      status={t('status')}
      title={t('profile.title')}
    />
  );
}
