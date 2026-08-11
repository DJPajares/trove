import { WifiOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function OfflinePage() {
  const t = await getTranslations('offline');

  return (
    <section
      aria-labelledby="offline-heading"
      className="grid min-h-[calc(100dvh-10rem)] items-center"
    >
      <PageState
        description={t('description')}
        eyebrow={t('eyebrow')}
        headingId="offline-heading"
        icon={<WifiOff aria-hidden="true" />}
        kind="offline"
        title={t('title')}
      />
    </section>
  );
}
