import { Wrench } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PagePlaceholder } from '@/components/page-placeholder';

export default async function ToolsPage() {
  const t = await getTranslations('placeholder');

  return (
    <PagePlaceholder
      description={t('tools.description')}
      eyebrow={t('eyebrow')}
      icon={<Wrench aria-hidden="true" className="size-6" />}
      status={t('status')}
      title={t('tools.title')}
    />
  );
}
