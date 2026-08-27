import { ItineraryManager } from '@/components/itinerary-manager';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

export default async function TripItineraryPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <ItineraryManager planScoreEnabled={isPlanScoreEnabled()} tripId={tripId} />;
}
