import { journalSerif } from '@/components/memories/journal-font';
import { TripDetail } from '@/components/trip-detail';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

export default async function TripPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return (
    <div className={journalSerif.variable}>
      <TripDetail planScoreEnabled={isPlanScoreEnabled()} tripId={tripId} />
    </div>
  );
}
