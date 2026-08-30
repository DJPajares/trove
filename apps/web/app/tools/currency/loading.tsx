import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** The converter's heading and the shape of its card, at the size they land. */
export default async function CurrencyLoading() {
  const t = await getTranslations('currency');

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader description={t('description')} title={t('title')} />
      <div aria-busy="true" aria-live="polite" role="status">
        <span className="sr-only">{t('title')}</span>
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]"
        >
          <div className="space-y-6 p-5 sm:p-6">
            <Skeleton className="h-11 w-full max-w-xs rounded-[var(--radius-md)]" />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
              <Skeleton className="h-11 w-full rounded-full sm:mt-7 sm:w-11" />
              <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
            </div>
          </div>
          <div className="min-h-[7.5rem] space-y-3 border-t border-border-subtle bg-muted/35 px-5 py-5 sm:px-6">
            <Skeleton className="h-4 w-32 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-8 w-48 rounded-[var(--radius-sm)]" />
          </div>
        </div>
      </div>
    </section>
  );
}
