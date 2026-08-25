import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function MemoriesLoading() {
  const t = await getTranslations('memories.story');
  return <PageState kind="loading" loadingShape="tripHero" title={t('loading')} />;
}
