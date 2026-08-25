import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function AppLoading() {
  const t = await getTranslations('app');
  return <PageState kind="loading" loadingShape="text" title={t('loading')} />;
}
