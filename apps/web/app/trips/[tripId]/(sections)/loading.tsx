import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';

/**
 * The cover and the navigation row are painted by the section layout, so a
 * screen that is still loading blanks only what is below them. This is the same
 * component each section manager renders while its own data is in flight, which
 * is what makes the handoff from the server skeleton to the client one invisible.
 */
export default async function TripSectionLoading() {
  const t = await getTranslations('trips');
  return <PageState kind="loading" loadingShape="tripSection" title={t('tripLoading')} />;
}
