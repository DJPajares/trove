import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** Profile's heading is fixed text; only its settings panels wait. */
export default async function ProfileLoading() {
  const t = await getTranslations('profile');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-10">
      <PageHeader description={t('description')} title={t('title')} />
      <div aria-busy="true" aria-live="polite" className="space-y-10" role="status">
        <span className="sr-only">{t('loading')}</span>
        {[0, 1, 2].map((panel) => (
          <div aria-hidden="true" className="space-y-4" key={panel}>
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
          </div>
        ))}
      </div>
    </section>
  );
}
