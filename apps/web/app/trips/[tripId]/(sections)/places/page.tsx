import { TripPlacesManager } from '@/components/trip-places-manager';

export default async function TripPlacesPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TripPlacesManager tripId={tripId} />;
}
