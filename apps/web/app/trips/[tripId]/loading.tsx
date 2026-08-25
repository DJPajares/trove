import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function TripLoading() {
  const t = await getTranslations('trips');
  return <PageState kind="loading" loadingShape="trip" title={t('tripLoading')} />;
}
