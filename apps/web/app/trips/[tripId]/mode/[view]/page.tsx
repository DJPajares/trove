import { notFound } from 'next/navigation';

import { TripModeMapView } from '@/components/trip-mode-map-view';
import { TripModeTripView } from '@/components/trip-mode-trip-view';
import { TripModeTodayView } from '@/components/trip-mode-today-view';
import type { TripModeView } from '@/lib/trips/trip-mode-views';

const supportedViews = new Set<TripModeView>(['today', 'map', 'trip']);

export default async function TripModeViewPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string; view: string }> }>) {
  const { tripId, view } = await params;
  if (!supportedViews.has(view as TripModeView)) notFound();

  if (view === 'map') return <TripModeMapView tripId={tripId} />;
  if (view === 'trip') return <TripModeTripView tripId={tripId} />;
  // `supportedViews` has already turned everything else away, so what is left
  // is Today. Now is the index route rather than a view here.
  return <TripModeTodayView tripId={tripId} />;
}
