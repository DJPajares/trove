import { getTranslations } from 'next-intl/server';

import { journalSerif } from '@/components/memories/journal-font';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Settings' heading is fixed text; only its panels wait. */
export default async function SettingsLoading() {
  const t = await getTranslations('profile');

  return (
    <div className={journalSerif.variable}>
      <section className="mx-auto w-full max-w-3xl space-y-7">
        <PageHeader
          description={t('description')}
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleFont="journal"
        />
        <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
          <span className="sr-only">{t('loading')}</span>
          {[18, 10, 15, 24, 14, 14].map((height, panel) => (
            <Card aria-hidden="true" className="gap-5 p-5 sm:p-6" key={panel}>
              <div className="flex items-start gap-3">
                <Skeleton className="size-5 shrink-0 rounded-full motion-reduce:animate-none" />
                <div className="w-full space-y-2">
                  <Skeleton className="h-5 w-44 motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
                </div>
              </div>
              <Skeleton
                className="w-full rounded-[var(--radius-md)] motion-reduce:animate-none"
                style={{ height: `${height}rem` }}
              />
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
