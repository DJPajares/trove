import { getTranslations } from 'next-intl/server';
import { Compass } from 'lucide-react';

import { PageState } from '@/components/page-state';

export default async function HomePage() {
  const t = await getTranslations('home');

  return (
    <section
      aria-labelledby="home-heading"
      className="grid min-h-[calc(100dvh-10rem)] items-center"
    >
      <PageState
        description={t('description')}
        detail={t('status')}
        eyebrow={t('eyebrow')}
        headingId="home-heading"
        icon={<Compass aria-hidden="true" />}
        title={t('title')}
      />
    </section>
  );
}
