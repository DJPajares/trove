import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';

/**
 * The library's heading is a fixed string, so there is nothing to blank about
 * it — showing it straight away is both faster and truer than a grey bar that
 * gets replaced by the same words. Only the trips themselves wait, in a list
 * the manager repeats verbatim once it takes over.
 */
export default async function TripsLoading() {
  const t = await getTranslations('trips');

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader
        actions={
          <Button disabled type="button">
            {t('newTrip')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />
      <PageState
        headingLevel={2}
        kind="loading"
        loadingShape="list"
        scope="section"
        title={t('loading')}
      />
    </section>
  );
}
