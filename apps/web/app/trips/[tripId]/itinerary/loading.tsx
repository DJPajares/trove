import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function ItineraryLoading() {
  const t = await getTranslations('itinerary');
  return <PageState kind="loading" loadingShape="tripHero" title={t('loading')} />;
}
