import { journalSerif } from '@/components/memories/journal-font';
import { TripDetail } from '@/components/trip-detail';
import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';

export default function TripPage() {
  return (
    <div className={journalSerif.variable}>
      <TripDetail planScoreEnabled={isPlanScoreEnabled()} />
    </div>
  );
}
