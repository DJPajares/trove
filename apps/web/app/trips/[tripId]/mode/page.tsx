import { TripModeNowView } from '@/components/trip-mode-now-view';

export default async function TripModeNowPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TripModeNowView tripId={tripId} />;
}
