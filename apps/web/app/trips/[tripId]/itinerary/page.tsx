import { ItineraryManager } from '@/components/itinerary-manager';

export default async function TripItineraryPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <ItineraryManager tripId={tripId} />;
}
