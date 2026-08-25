import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function TripsLoading() {
  const t = await getTranslations('trips');
  return (
    <PageState
      className="mx-auto max-w-6xl"
      kind="loading"
      loadingShape="list"
      title={t('loading')}
    />
  );
}
