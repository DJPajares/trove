import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { LibrarySkeleton } from '@/components/trips-library/library-skeleton';
import { Button } from '@/components/ui/button';

/**
 * The library's heading is a fixed string, so there is nothing to blank about
 * it — showing it straight away is both faster and truer than a grey bar that
 * gets replaced by the same words. Only the trips themselves wait, in the
 * shape the manager repeats verbatim once it takes over.
 */
export default async function TripsLoading() {
  const t = await getTranslations('trips');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-10 sm:space-y-12">
      <PageHeader
        actions={
          <Button className="max-md:hidden" disabled type="button">
            {t('newTrip')}
          </Button>
        }
        title={t('title')}
      />
      <LibrarySkeleton label={t('loading')} />
    </section>
  );
}
