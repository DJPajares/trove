import { getTranslations } from 'next-intl/server';

import { SavedCollectionSkeleton } from '@/components/saved/saved-collection-skeleton';

// A loading boundary is rendered without the route's params, and this page
// reads its collection from them - so it cannot stand in for itself the way
// Saved does. It shows the collection's shape instead.
export default async function SavedCollectionLoading() {
  const t = await getTranslations('saved');
  return <SavedCollectionSkeleton label={t('loading')} />;
}
