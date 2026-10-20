import { ArchivedTripsManager } from '@/components/archived-trips-manager';
import { journalSerif } from '@/components/memories/journal-font';

export default function ArchivedTripsPage() {
  return (
    <div className={journalSerif.variable}>
      <ArchivedTripsManager />
    </div>
  );
}
