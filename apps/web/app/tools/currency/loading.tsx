import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** The converter's heading and the shape of its form, at the size they land. */
export default async function CurrencyLoading() {
  const t = await getTranslations('currency');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader description={t('description')} title={t('title')} />
      <div aria-busy="true" aria-live="polite" className="space-y-4" role="status">
        <span className="sr-only">{t('title')}</span>
        <Skeleton aria-hidden="true" className="h-11 w-full rounded-[var(--radius-md)]" />
        <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
        </div>
        <Skeleton aria-hidden="true" className="h-24 w-full rounded-[var(--radius-lg)]" />
      </div>
    </section>
  );
}
