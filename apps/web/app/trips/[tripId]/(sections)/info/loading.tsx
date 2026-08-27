import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

/** The same skeleton the manager shows while its own request is in flight. */
export default async function Loading() {
  const t = await getTranslations('trips');
  return <PageState kind="loading" loadingShape="list" title={t('tripLoading')} />;
}
