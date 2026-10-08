import { journalSerif } from '@/components/memories/journal-font';
import { TripsManager } from '@/components/trips-manager';

/**
 * The library sets its finished journeys in the Memories journal's serif, so
 * the font is loaded here as well as on the journal itself.
 */
export default function TripsPage() {
  return (
    <div className={journalSerif.variable}>
      <TripsManager />
    </div>
  );
}
