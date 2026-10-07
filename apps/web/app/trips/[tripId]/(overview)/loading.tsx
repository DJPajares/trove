import { getTranslations } from 'next-intl/server';

import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';

export default async function TripLoading() {
  const t = await getTranslations('trips');
  return (
    <div className="mx-auto w-full max-w-5xl">
      <TripDetailSkeleton label={t('tripLoading')} />
    </div>
  );
}
