import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { ProfileSectionNavigation } from '@/components/profile-section-navigation';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Profile's heading is fixed text; only its settings panels wait. */
export default async function ProfileLoading() {
  const t = await getTranslations('profile');

  return (
    <section className="mx-auto w-full max-w-6xl space-y-10">
      <PageHeader description={t('description')} title={t('title')} />
      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <ProfileSectionNavigation />
        <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
          <span className="sr-only">{t('loading')}</span>
          {[18, 14, 10, 15, 24, 14, 14].map((height, panel) => (
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
      </div>
    </section>
  );
}
