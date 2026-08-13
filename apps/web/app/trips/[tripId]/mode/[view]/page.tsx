import { notFound } from 'next/navigation';

import { TripModeViewContent, type TripModeView } from '@/components/trip-mode-view';

const supportedViews = new Set<TripModeView>(['today', 'map', 'trip']);

export default async function TripModeViewPage({
  params,
}: Readonly<{ params: Promise<{ view: string }> }>) {
  const { view } = await params;
  if (!supportedViews.has(view as TripModeView)) notFound();

  return <TripModeViewContent view={view as TripModeView} />;
}
