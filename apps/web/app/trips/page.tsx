import { MapPinned } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PagePlaceholder } from '@/components/page-placeholder';

export default async function TripsPage() {
  const t = await getTranslations('placeholder');

  return (
    <PagePlaceholder
      description={t('trips.description')}
      eyebrow={t('eyebrow')}
      icon={<MapPinned aria-hidden="true" className="size-6" />}
      status={t('status')}
      title={t('trips.title')}
    />
  );
}
