import { getTranslations } from 'next-intl/server';

import { journalSerif } from '@/components/memories/journal-font';
import { PageHeader } from '@/components/page-header';
import { ToolsBackLink } from '@/components/tools/tools-back-link';
import { Skeleton } from '@/components/ui/skeleton';

/** The converter's heading and the shape of its card, at the size they land. */
export default async function CurrencyLoading() {
  const t = await getTranslations('currency');

  return (
    <div className={journalSerif.variable}>
      <section className="mx-auto w-full max-w-5xl space-y-6">
        <div>
          <ToolsBackLink label={t('back')} />
          <PageHeader eyebrow={t('eyebrow')} title={t('title')} titleFont="journal" />
        </div>
        <div aria-busy="true" aria-live="polite" role="status">
          <span className="sr-only">{t('loadingRates')}</span>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
            <div
              aria-hidden="true"
              className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]"
            >
              <div className="space-y-3 px-5 pt-4 pb-6 sm:px-7">
                <Skeleton className="h-9 w-36 rounded-[var(--radius-md)]" />
                <Skeleton className="h-14 w-32 rounded-[var(--radius-md)]" />
              </div>
              <div className="space-y-3 border-t border-border-subtle bg-surface-tint px-5 pt-4 pb-6 sm:px-7">
                <Skeleton className="h-9 w-44 rounded-[var(--radius-md)]" />
                <Skeleton className="h-14 w-48 rounded-[var(--radius-md)]" />
                <Skeleton className="h-4 w-56 rounded-[var(--radius-sm)]" />
              </div>
            </div>
            <Skeleton
              aria-hidden="true"
              className="h-40 w-full rounded-[var(--radius-xl)] max-lg:hidden"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
