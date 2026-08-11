import { Bookmark } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PagePlaceholder } from '@/components/page-placeholder';

export default async function SavedPage() {
  const t = await getTranslations('placeholder');

  return (
    <PagePlaceholder
      description={t('saved.description')}
      eyebrow={t('eyebrow')}
      icon={<Bookmark aria-hidden="true" className="size-6" />}
      status={t('status')}
      title={t('saved.title')}
    />
  );
}
