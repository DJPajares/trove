import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

/**
 * The planner's own loading state: the ribbon, the day's header and its first
 * stops, in the boxes the day lands in. It is the same shape the planner shows
 * while its data is in flight, so the handoff from server to client is
 * invisible.
 */
export default async function ItineraryLoading() {
  const t = await getTranslations('itinerary');
  return <PageState kind="loading" loadingShape="planner" title={t('loading')} />;
}
