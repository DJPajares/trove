import { TripDetail } from '@/components/trip-detail';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

export default async function TripPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TripDetail planScoreEnabled={isPlanScoreEnabled()} tripId={tripId} />;
}
