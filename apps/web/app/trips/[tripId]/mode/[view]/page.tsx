import { notFound } from 'next/navigation';

import { TripModeTodayView } from '@/components/trip-mode-today-view';
import { TripModeViewContent, type TripModeView } from '@/components/trip-mode-view';

const supportedViews = new Set<TripModeView>(['today', 'map', 'trip']);

export default async function TripModeViewPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string; view: string }> }>) {
  const { tripId, view } = await params;
  if (!supportedViews.has(view as TripModeView)) notFound();

  if (view === 'today') return <TripModeTodayView tripId={tripId} />;
  return <TripModeViewContent view={view as TripModeView} />;
}
