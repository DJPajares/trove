import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

export default async function SavedLoading() {
  const t = await getTranslations('saved');
  return (
    <PageState
      className="mx-auto max-w-6xl"
      kind="loading"
      loadingShape="list"
      title={t('loading')}
    />
  );
}
