import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

/**
 * Only reached on a cold visit to a draft — arriving from the generating
 * takeover, the session is already in the query cache and the takeover's own
 * fade covers the first paint.
 */
export default async function AiPlanningReviewLoading() {
  const t = await getTranslations('trips.aiPlanning.review');

  return <PageState kind="loading" loadingShape="text" scope="page" title={t('loading')} />;
}
